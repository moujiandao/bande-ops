-- Rebuildable, non-PII evidence. Report identifiers are retained for provenance;
-- customer destinations and order/shipment/item identifiers are never stored.
create table public.shipment_evidence_batches (
  id uuid primary key default gen_random_uuid(),
  marketplace_id text not null,
  lane text not null check (lane in ('recent', 'backfill')),
  start_date date not null,
  end_date date not null check (end_date >= start_date and end_date - start_date < 21),
  classification_version integer not null,
  status text not null default 'pending' check (status in ('pending', 'complete', 'failed')),
  sales_report_id text,
  promotions_report_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  issue text,
  unique (id, marketplace_id)
);
create unique index shipment_evidence_one_pending on public.shipment_evidence_batches (marketplace_id, lane) where status = 'pending';
create index shipment_evidence_recent on public.shipment_evidence_batches (marketplace_id, lane, created_at desc);

create table public.shipment_adjustment_days (
  batch_id uuid not null,
  marketplace_id text not null,
  sku text not null,
  activity_date date not null,
  ledger_units integer not null check (ledger_units >= 0),
  shipment_units integer not null check (shipment_units >= 0),
  excluded_units integer,
  vine_units integer not null check (vine_units >= 0),
  status text not null check (status in ('complete', 'unknown')),
  issue text,
  primary key (batch_id, sku, activity_date),
  foreign key (batch_id, marketplace_id) references public.shipment_evidence_batches(id, marketplace_id) on delete cascade,
  check ((status = 'complete' and excluded_units is not null and excluded_units between 0 and ledger_units and vine_units <= excluded_units and shipment_units = ledger_units and issue is null)
      or (status = 'unknown' and excluded_units is null and issue is not null))
);
create index shipment_adjustment_history on public.shipment_adjustment_days (marketplace_id, activity_date, sku);

create table public.shipment_sync_leases (
  marketplace_id text primary key,
  token uuid not null,
  expires_at timestamptz not null
);

alter table public.shipment_evidence_batches enable row level security;
alter table public.shipment_adjustment_days enable row level security;
alter table public.shipment_sync_leases enable row level security;
revoke all on public.shipment_evidence_batches, public.shipment_adjustment_days, public.shipment_sync_leases from public, anon, authenticated;
grant select on public.shipment_evidence_batches, public.shipment_adjustment_days to authenticated;
grant all on public.shipment_evidence_batches, public.shipment_adjustment_days, public.shipment_sync_leases to service_role;
create policy shipment_evidence_read on public.shipment_evidence_batches for select to authenticated using (true);
create policy shipment_adjustment_read on public.shipment_adjustment_days for select to authenticated using (true);

-- Incomplete writes cannot shadow a previously published generation. Use the
-- newest request, not the last-finishing job, when ranges overlap.
create view public.current_shipment_adjustments with (security_invoker = true) as
select distinct on (d.marketplace_id, d.sku, d.activity_date)
  d.*, b.classification_version, b.created_at as requested_at, b.completed_at
from public.shipment_adjustment_days d
join public.shipment_evidence_batches b on b.id = d.batch_id
where b.status = 'complete'
order by d.marketplace_id, d.sku, d.activity_date, b.created_at desc, b.id desc;
revoke all on public.current_shipment_adjustments from public, anon, authenticated;
grant select on public.current_shipment_adjustments to authenticated, service_role;

create function public.claim_shipment_sync(p_marketplace text, p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.shipment_sync_leases (marketplace_id, token, expires_at)
  values (p_marketplace, p_token, now() + interval '15 minutes')
  on conflict (marketplace_id) do update set token = excluded.token, expires_at = excluded.expires_at
  where public.shipment_sync_leases.expires_at < now();
  return found;
end;
$$;

-- Publication is one transaction with a fencing token. A timed-out worker
-- cannot publish after a newer worker has acquired the marketplace lease.
create function public.publish_shipment_evidence(p_batch uuid, p_token uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.shipment_evidence_batches;
begin
  select * into strict b from public.shipment_evidence_batches where id = p_batch for update;
  if b.status <> 'pending' then raise exception 'Batch is not pending'; end if;
  perform 1 from public.shipment_sync_leases where marketplace_id = b.marketplace_id
    and token = p_token and expires_at > now() for update;
  if not found then raise exception 'Shipment sync lease lost'; end if;
  if b.sales_report_id is null or b.promotions_report_id is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'Source coverage is incomplete';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as r(activity_date date)
      where r.activity_date < b.start_date or r.activity_date > b.end_date or r.activity_date is null) then
    raise exception 'Adjustment outside batch coverage';
  end if;
  insert into public.shipment_adjustment_days
    (batch_id, marketplace_id, sku, activity_date, ledger_units, shipment_units, excluded_units, vine_units, status, issue)
  select b.id, b.marketplace_id, r.sku, r.activity_date, r.ledger_units, r.shipment_units,
    r.excluded_units, r.vine_units, r.status, r.issue
  from jsonb_to_recordset(p_rows) as r(sku text, activity_date date, ledger_units integer,
    shipment_units integer, excluded_units integer, vine_units integer, status text, issue text);
  update public.shipment_evidence_batches set status = 'complete', completed_at = now(), issue = null where id = b.id;
end;
$$;

create function public.release_shipment_sync(p_marketplace text, p_token uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.shipment_sync_leases where marketplace_id = p_marketplace and token = p_token;
$$;
create function public.update_shipment_evidence(p_batch uuid, p_token uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.shipment_evidence_batches;
begin
  select * into strict b from public.shipment_evidence_batches where id = p_batch for update;
  perform 1 from public.shipment_sync_leases where marketplace_id = b.marketplace_id
    and token = p_token and expires_at > now() for update;
  if not found then raise exception 'Shipment sync lease lost'; end if;
  if b.status <> 'pending' then raise exception 'Batch is not pending'; end if;
  update public.shipment_evidence_batches set
    sales_report_id = coalesce(p_patch->>'sales_report_id', sales_report_id),
    promotions_report_id = coalesce(p_patch->>'promotions_report_id', promotions_report_id),
    status = case when p_patch->>'status' = 'failed' then 'failed' else status end,
    issue = coalesce(p_patch->>'issue', issue)
  where id = p_batch;
end;
$$;
revoke all on function public.update_shipment_evidence(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_shipment_evidence(uuid, uuid, jsonb) to service_role;
revoke all on function public.claim_shipment_sync(text, uuid), public.publish_shipment_evidence(uuid, uuid, jsonb), public.release_shipment_sync(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_shipment_sync(text, uuid), public.publish_shipment_evidence(uuid, uuid, jsonb), public.release_shipment_sync(text, uuid) to service_role;

comment on column public.analytics_settings.exclude_vine is
  'Exclude reconciled Vine and fully discounted item shipments from momentum. Does not change operational reorder forecasts.';
