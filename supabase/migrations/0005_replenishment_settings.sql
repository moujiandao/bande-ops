-- 0005_replenishment_settings.sql
-- Replenishment settings (Module: Replenishment, decision-support only).
--
-- This is part of our OPERATIONAL LAYER (data Amazon does not store), so this
-- table is AUTHORITATIVE — it is NOT a synced mirror. It holds the inputs to
-- the reorder math: lead time and safety stock, either as a single global
-- default (the row where `sku IS NULL`) or as a per-SKU override. See ADR-0001
-- and CONTEXT.md.
--
-- Because these rows are user-authored, RLS grants authenticated users
-- SELECT/INSERT/UPDATE directly (no service-role-only sync path, unlike the
-- mirror tables). There is intentionally no DELETE policy.

create table if not exists public.replenishment_settings (
  id              uuid        primary key default gen_random_uuid(),
  -- Carry the marketplace dimension from day one (default US).
  marketplace_id  text        not null default 'ATVPDKIKX0DER',
  -- NULL sku == the global default row. A non-null sku is a per-SKU override
  -- that wins over the default for that SKU.
  sku             text,
  lead_time_days  integer     not null check (lead_time_days >= 0),
  safety_stock    integer     not null check (safety_stock >= 0),
  updated_at      timestamptz not null default now()
);

-- One default row + one row per SKU per marketplace. A plain unique constraint
-- on (marketplace_id, sku) would NOT collapse multiple NULL-sku rows (NULLs are
-- distinct in SQL uniqueness), so we key on coalesce(sku, '') via a unique
-- expression index to pin exactly one global default per marketplace.
create unique index if not exists replenishment_settings_marketplace_sku_key
  on public.replenishment_settings (marketplace_id, coalesce(sku, ''));

-- Row Level Security: default-deny, then open the user-authored paths below.
alter table public.replenishment_settings enable row level security;

-- Authenticated users may read all settings.
create policy "replenishment_settings_select_authenticated"
  on public.replenishment_settings
  for select
  to authenticated
  using (true);

-- Authenticated users may author (insert) settings. Unlike the synced mirrors,
-- these rows are ours — created and edited by the end user, not by a sync.
create policy "replenishment_settings_insert_authenticated"
  on public.replenishment_settings
  for insert
  to authenticated
  with check (true);

-- Authenticated users may edit existing settings.
create policy "replenishment_settings_update_authenticated"
  on public.replenishment_settings
  for update
  to authenticated
  using (true)
  with check (true);
