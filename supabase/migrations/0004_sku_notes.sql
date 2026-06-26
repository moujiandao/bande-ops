-- 0004_sku_notes.sql
-- Per-SKU operator notes (Module 1: Catalog & Inventory).
--
-- This is part of our OPERATIONAL LAYER, NOT a synced mirror: notes are
-- user-authored content that Amazon does not store, so this table is
-- authoritative and is never rebuilt from Amazon. Contrast with catalog_items /
-- inventory_levels (mirrors, service-role writes only). See ADR-0001.
--
-- Because the rows are user-authored, RLS opens an authenticated write path
-- here (SELECT + INSERT + UPDATE) — unlike the mirrors, which are read-only to
-- end users. There is intentionally no DELETE policy: clearing a note is an
-- UPDATE to the empty string, not a row deletion.

create table if not exists public.sku_notes (
  -- Natural key matches the mirrors so notes join cleanly to catalog rows on
  -- (marketplace_id, sku). Carry the marketplace dimension from day one.
  marketplace_id text        not null default 'ATVPDKIKX0DER',
  sku            text        not null,
  -- Free-form operator note. Defaults to '' so an "empty note" is a real row
  -- with empty text rather than a NULL; clearing a note is set note = ''.
  note           text        not null default '',
  updated_at     timestamptz not null default now(),
  primary key (marketplace_id, sku)
);

comment on table public.sku_notes is
  'Operational layer (NOT a synced mirror): user-authored per-SKU notes. Authoritative; never rebuilt from Amazon.';

-- Row Level Security: default-deny, then open the authenticated read+write
-- paths below. Safe here (unlike the mirrors) because the data is user-authored.
alter table public.sku_notes enable row level security;

-- Authenticated users may read all notes.
create policy "sku_notes_select_authenticated"
  on public.sku_notes
  for select
  to authenticated
  using (true);

-- Authenticated users may create notes. WITH CHECK gates the inserted row.
create policy "sku_notes_insert_authenticated"
  on public.sku_notes
  for insert
  to authenticated
  with check (true);

-- Authenticated users may edit notes. WITH CHECK gates the post-update row so
-- an UPDATE cannot move a row outside the authenticated-visible set.
create policy "sku_notes_update_authenticated"
  on public.sku_notes
  for update
  to authenticated
  using (true)
  with check (true);
