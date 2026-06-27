-- 0007_ads_campaign_metrics.sql
-- Synced mirror of Amazon Advertising campaign PERFORMANCE metrics (Module 2:
-- Ads, slice A2).
--
-- This is a SYNCED MIRROR, not authoritative: every row is re-fetchable from
-- the Amazon Advertising API v3 async reporting flow (the source of truth) and
-- rebuildable from scratch. It carries `synced_at` to record when we last
-- pulled it. Never treat this table as the system of record. See ADR-0001 and
-- supabase/README.md.
--
-- Stores only the RAW report inputs (impressions/clicks/cost/sales). ACOS and
-- ROAS are deliberately NOT columns: Amazon never returns them, and we compute
-- them at render time from cost/sales (see lib/ads/metrics.ts) so the
-- divide-by-zero -> UNKNOWN rule lives in one tested place.
--
-- Writes happen only via the server-side service role (which bypasses RLS) on
-- the sync path; end users never INSERT/UPDATE/DELETE here. RLS grants
-- authenticated users read-only access.

create table if not exists public.ads_campaign_metrics (
  -- Carry the marketplace dimension from day one (default US). A campaign id is
  -- unique per marketplace, so the natural key is (marketplace_id, campaign_id),
  -- matching ads_campaigns for a clean join.
  marketplace_id text        not null default 'ATVPDKIKX0DER',
  campaign_id    text        not null,
  -- UNKNOWN-metric rule: every metric is NULLABLE. NULL means Amazon reported
  -- no value (UNKNOWN), flagged for review. NULL is semantically distinct from
  -- a true 0 (e.g. zero clicks) and must NEVER be coalesced to 0 — doing so
  -- would read as "no spend / no sales" and corrupt computed ACOS/ROAS.
  -- Mirrors the UNKNOWN-stock / UNKNOWN-budget conventions. See CONTEXT.md.
  impressions    numeric,
  clicks         numeric,
  cost           numeric,  -- ad spend; NULL = UNKNOWN, never 0
  sales          numeric,  -- attribution-windowed sales; NULL = UNKNOWN, never 0
  synced_at      timestamptz not null default now(),
  primary key (marketplace_id, campaign_id)
);

comment on column public.ads_campaign_metrics.cost is
  'Ad spend. NULL = UNKNOWN (Amazon reported no value); never coalesce to 0.';
comment on column public.ads_campaign_metrics.sales is
  'Attribution-windowed sales. NULL = UNKNOWN; never coalesce to 0. ACOS/ROAS computed downstream.';

-- Row Level Security: default-deny, then open a single read path below.
alter table public.ads_campaign_metrics enable row level security;

-- Authenticated users may read the mirror. There is intentionally NO
-- insert/update/delete policy: the sync path uses the service role, which
-- bypasses RLS, and end users must never mutate a synced mirror directly.
create policy "ads_campaign_metrics_select_authenticated"
  on public.ads_campaign_metrics
  for select
  to authenticated
  using (true);
