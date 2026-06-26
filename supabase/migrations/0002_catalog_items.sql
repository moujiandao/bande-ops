-- 0002_catalog_items.sql
-- Synced mirror of the Amazon catalog (Module 1: Catalog & Inventory).
--
-- This is a SYNCED MIRROR, not authoritative: every row is re-fetchable from
-- Amazon (the source of truth) and rebuildable from scratch. It carries
-- `synced_at` to record when we last pulled it. Never treat this table as the
-- system of record. See ADR-0001 and supabase/README.md.
--
-- Writes happen only via the server-side service role (which bypasses RLS) on
-- the sync path; end users never INSERT/UPDATE/DELETE here. RLS grants
-- authenticated users read-only access.

create table if not exists public.catalog_items (
  -- Carry the marketplace dimension from day one (default US), even though only
  -- US is exercised now. SKU is unique per marketplace, so the natural key is
  -- (marketplace_id, sku).
  marketplace_id text        not null default 'ATVPDKIKX0DER',
  sku            text        not null,
  asin           text        not null,
  title          text        not null,
  image_url      text,
  synced_at      timestamptz not null default now(),
  primary key (marketplace_id, sku)
);

-- Row Level Security: default-deny, then open a single read path below.
alter table public.catalog_items enable row level security;

-- Authenticated users may read the mirror. There is intentionally NO
-- insert/update/delete policy: the sync path uses the service role, which
-- bypasses RLS, and end users must never mutate a synced mirror directly.
create policy "catalog_items_select_authenticated"
  on public.catalog_items
  for select
  to authenticated
  using (true);
