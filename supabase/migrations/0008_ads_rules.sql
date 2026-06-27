-- 0008_ads_rules.sql
-- Ads rules: the per-marketplace ACOS target behind the wasted-spend flags
-- (Module 2: Ads, slice A4 — "make spend actionable").
--
-- This is part of our OPERATIONAL LAYER (data Amazon does not store), so this
-- table is AUTHORITATIVE — it is NOT a synced mirror. It holds a single
-- user-authored ACOS target per marketplace; the /ads page compares each
-- campaign's COMPUTED ACOS (cost/sales, see lib/ads/metrics.ts) against this
-- target to flag 'high-acos'. See ADR-0001 and CONTEXT.md.
--
-- Because these rows are user-authored, RLS grants authenticated users
-- SELECT/INSERT/UPDATE directly (no service-role-only sync path, unlike the
-- ads_campaigns / ads_campaign_metrics mirror tables). There is intentionally
-- no DELETE policy.

create table if not exists public.ads_rules (
  id              uuid        primary key default gen_random_uuid(),
  -- Carry the marketplace dimension from day one (default US). Exactly one row
  -- per marketplace (the unique constraint below) — this is a single setting,
  -- not a per-campaign table.
  marketplace_id  text        not null default 'ATVPDKIKX0DER',
  -- Target ACOS stored as a RATIO (0.25 = 25%), so it is directly comparable to
  -- acos() output (cost/sales) with no unit conversion in the hot path. The
  -- /ads UI displays and edits this as a percentage at the edge; the ratio is
  -- the single internal unit. Must be positive — a non-positive target has no
  -- meaning. NULL is disallowed: a row exists only once a target has been set.
  acos_target     numeric     not null check (acos_target > 0),
  updated_at      timestamptz not null default now()
);

comment on column public.ads_rules.acos_target is
  'Target ACOS as a RATIO (0.25 = 25%), comparable to acos() output. UI edits it as a percent; the ratio is the internal unit.';

-- One target row per marketplace.
create unique index if not exists ads_rules_marketplace_key
  on public.ads_rules (marketplace_id);

-- Row Level Security: default-deny, then open the user-authored paths below.
alter table public.ads_rules enable row level security;

-- Authenticated users may read the target.
create policy "ads_rules_select_authenticated"
  on public.ads_rules
  for select
  to authenticated
  using (true);

-- Authenticated users may author (insert) the target. Unlike the synced
-- mirrors, these rows are ours — created and edited by the end user, not a sync.
create policy "ads_rules_insert_authenticated"
  on public.ads_rules
  for insert
  to authenticated
  with check (true);

-- Authenticated users may edit the existing target.
create policy "ads_rules_update_authenticated"
  on public.ads_rules
  for update
  to authenticated
  using (true)
  with check (true);
