-- 0009_ads_write_log.sql
-- Ads write-back AUDIT LOG (Module 2: Ads, slice A5 — the first write-back to
-- Amazon).
--
-- Every owner-initiated write to a Sponsored Products campaign (pause/enable or
-- a daily-budget change — i.e. stopping ads or changing spend) MUST leave a row
-- here: who did it, which campaign, what changed (before -> after), and when.
-- This is OPERATIONAL data Amazon does not store (it is the audit trail of OUR
-- actions), so the table is authoritative — it is NOT a synced mirror.
--
-- APPEND-ONLY: a row, once written, is never updated or deleted. There are
-- deliberately NO update/delete policies, so even an authenticated user cannot
-- rewrite history through the API. RLS grants authenticated users SELECT (to
-- review the trail) and INSERT (the write action runs as the authenticated
-- owner). The insert is bound to the caller's own identity (actor_email must
-- equal the JWT email) so a logged actor cannot be forged.

create table if not exists public.ads_write_log (
  id              uuid        primary key default gen_random_uuid(),
  -- Carry the marketplace dimension from day one (default US).
  marketplace_id  text        not null default 'ATVPDKIKX0DER',
  -- The campaign that was written to (Amazon campaignId, as text).
  campaign_id     text        not null,
  -- Email of the OWNER who initiated the write (the actor). Bound to the JWT by
  -- the insert policy below so it cannot be spoofed.
  actor_email     text        not null,
  -- The change: { kind, before: {...}, after: {...} }. kind is one of
  -- 'pause' | 'lower-budget' | 'raise-budget'; before/after capture the campaign
  -- state + daily budget around the write.
  change          jsonb       not null,
  created_at      timestamptz not null default now()
);

comment on table public.ads_write_log is
  'Append-only audit log of owner-initiated Amazon Advertising write-backs (operational; not a synced mirror).';
comment on column public.ads_write_log.change is
  'jsonb { kind, before, after } describing the applied campaign change.';

-- Read the trail newest-first efficiently.
create index if not exists ads_write_log_created_at_idx
  on public.ads_write_log (created_at desc);

-- Row Level Security: default-deny, then open only SELECT + a self-bound INSERT.
alter table public.ads_write_log enable row level security;

-- Authenticated users may read the audit trail.
create policy "ads_write_log_select_authenticated"
  on public.ads_write_log
  for select
  to authenticated
  using (true);

-- Authenticated users may append a row, but only attributed to THEMSELVES: the
-- actor_email must match the caller's JWT email. (Owner-role enforcement happens
-- in the server action via requireOwner(); this policy guarantees actor
-- integrity at the row level.) No service-role-only path is required.
create policy "ads_write_log_insert_self"
  on public.ads_write_log
  for insert
  to authenticated
  with check (actor_email = (auth.jwt() ->> 'email'));

-- Intentionally NO update or delete policy: the log is append-only.
