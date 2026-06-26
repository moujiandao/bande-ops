-- 0003_inventory_levels.sql
-- Synced mirror of Amazon inventory levels (Module 1: Catalog & Inventory).
--
-- This is a SYNCED MIRROR, not authoritative: every row is re-fetchable from
-- Amazon (the source of truth) and rebuildable from scratch. It carries
-- `synced_at` to record when we last pulled it. Never treat this table as the
-- system of record. See ADR-0001 and supabase/README.md.
--
-- Writes happen only via the server-side service role (which bypasses RLS) on
-- the sync path; end users never INSERT/UPDATE/DELETE here. RLS grants
-- authenticated users read-only access.

create table if not exists public.inventory_levels (
  -- SKU is unique per marketplace, so the natural key is (marketplace_id, sku),
  -- matching catalog_items so the two mirrors join cleanly.
  marketplace_id text        not null default 'ATVPDKIKX0DER',
  sku            text        not null,
  -- UNKNOWN-stock rule: NULL means Amazon reported the quantity as
  -- non-numeric/unavailable (UNKNOWN), flagged for review. NULL is semantically
  -- distinct from a true 0 (in-stock-zero) and must NEVER be coalesced to 0.
  -- See CONTEXT.md "Unknown stock" and CLAUDE.md "Do Not".
  total_quantity integer,
  fn_sku         text,
  synced_at      timestamptz not null default now(),
  primary key (marketplace_id, sku)
);

comment on column public.inventory_levels.total_quantity is
  'Total sellable quantity. NULL = UNKNOWN (Amazon non-numeric/unavailable); never coalesce to 0.';

-- Row Level Security: default-deny, then open a single read path below.
alter table public.inventory_levels enable row level security;

-- Authenticated users may read the mirror. There is intentionally NO
-- insert/update/delete policy: the sync path uses the service role, which
-- bypasses RLS, and end users must never mutate a synced mirror directly.
create policy "inventory_levels_select_authenticated"
  on public.inventory_levels
  for select
  to authenticated
  using (true);
