-- 0006_ads_campaigns.sql
-- Synced mirror of Amazon Advertising campaigns (Module 2: Ads).
--
-- This is a SYNCED MIRROR, not authoritative: every row is re-fetchable from
-- the Amazon Advertising API (the source of truth) and rebuildable from
-- scratch. It carries `synced_at` to record when we last pulled it. Never treat
-- this table as the system of record. See ADR-0001 and supabase/README.md.
--
-- Writes happen only via the server-side service role (which bypasses RLS) on
-- the sync path; end users never INSERT/UPDATE/DELETE here. RLS grants
-- authenticated users read-only access.

create table if not exists public.ads_campaigns (
  -- Carry the marketplace dimension from day one (default US), even though only
  -- US is exercised now. A campaign id is unique per marketplace, so the natural
  -- key is (marketplace_id, campaign_id).
  marketplace_id text        not null default 'ATVPDKIKX0DER',
  campaign_id    text        not null,
  name           text        not null,
  state          text        not null check (state in ('enabled', 'paused', 'archived')),
  -- UNKNOWN-budget rule: NULL means Amazon reported the daily budget as
  -- non-numeric/unavailable (UNKNOWN), flagged for review. NULL is semantically
  -- distinct from a true 0 and must NEVER be coalesced to 0. Mirrors the
  -- UNKNOWN-stock convention. See CONTEXT.md and CLAUDE.md "Do Not".
  daily_budget   numeric,
  synced_at      timestamptz not null default now(),
  primary key (marketplace_id, campaign_id)
);

comment on column public.ads_campaigns.daily_budget is
  'Daily budget. NULL = UNKNOWN (Amazon non-numeric/unavailable); never coalesce to 0.';

-- Row Level Security: default-deny, then open a single read path below.
alter table public.ads_campaigns enable row level security;

-- Authenticated users may read the mirror. There is intentionally NO
-- insert/update/delete policy: the sync path uses the service role, which
-- bypasses RLS, and end users must never mutate a synced mirror directly.
create policy "ads_campaigns_select_authenticated"
  on public.ads_campaigns
  for select
  to authenticated
  using (true);
