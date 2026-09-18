-- Run against an isolated local PostgreSQL database after migrations 0022/0023.
-- Requires Supabase-like anon/authenticated/service_role roles. Always rolls back.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if has_table_privilege('anon', 'public.shipment_adjustment_days', 'select')
    or has_table_privilege('authenticated', 'public.shipment_adjustment_days', 'insert')
    or has_table_privilege('authenticated', 'public.shipment_evidence_batches', 'update')
    or has_function_privilege('authenticated', 'public.publish_shipment_evidence(uuid, uuid, jsonb)', 'execute')
    or has_function_privilege('anon', 'public.claim_shipment_sync(text, uuid)', 'execute')
  then raise exception 'Mirror privileges are too broad'; end if;
end $$;
set local role service_role;
do $$ begin
  if not public.claim_shipment_sync('TEST', '10000000-0000-0000-0000-000000000001') then raise exception 'Lease not acquired'; end if;
  if public.claim_shipment_sync('TEST', '10000000-0000-0000-0000-000000000002') then raise exception 'Concurrent lease allowed'; end if;
end $$;
insert into public.shipment_evidence_batches
  (id, marketplace_id, lane, start_date, end_date, classification_version, sales_report_id, promotions_report_id, created_at)
values ('20000000-0000-0000-0000-000000000001', 'TEST', 'recent', '2026-03-11', '2026-03-11', 1, 'sales', 'promotions', '2026-03-13T00:00:00Z');
do $$ begin
  begin
    perform public.publish_shipment_evidence('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '[]');
    raise exception 'Stale worker published';
  exception when raise_exception then
    if sqlerrm <> 'Shipment sync lease lost' then raise; end if;
  end;
  begin
    perform public.update_shipment_evidence('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '{"status":"failed"}');
    raise exception 'Stale worker updated batch';
  exception when raise_exception then
    if sqlerrm <> 'Shipment sync lease lost' then raise; end if;
  end;
end $$;
select public.publish_shipment_evidence('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '[{"sku":"SKU", "activity_date":"2026-03-11", "ledger_units":5, "shipment_units":5, "excluded_units":3, "vine_units":3, "status":"complete", "issue":null}]');
insert into public.shipment_evidence_batches
  (id, marketplace_id, lane, start_date, end_date, classification_version, sales_report_id, promotions_report_id, created_at)
values ('20000000-0000-0000-0000-000000000002', 'TEST', 'recent', '2026-03-11', '2026-03-11', 1, 'sales2', 'promotions2', '2026-03-14T00:00:00Z');
do $$ begin
  if (select excluded_units from public.current_shipment_adjustments where marketplace_id = 'TEST') <> 3 then raise exception 'Pending generation shadowed published result'; end if;
  begin
    perform public.publish_shipment_evidence('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
      '[{"sku":"SKU", "activity_date":"2026-03-11", "ledger_units":5, "shipment_units":5, "excluded_units":6, "vine_units":6, "status":"complete", "issue":null}]');
    raise exception 'Invalid adjustment published';
  exception when check_violation then null;
  end;
  if exists(select 1 from public.shipment_adjustment_days where batch_id = '20000000-0000-0000-0000-000000000002') then raise exception 'Partial write leaked'; end if;
end $$;
select public.publish_shipment_evidence('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
  '[{"sku":"SKU", "activity_date":"2026-03-11", "ledger_units":5, "shipment_units":5, "excluded_units":0, "vine_units":0, "status":"complete", "issue":null}]');
set local role authenticated;
do $$ begin
  if (select count(*) from public.current_shipment_adjustments where marketplace_id = 'TEST') <> 1 then raise exception 'Authenticated mirror read failed'; end if;
  if (select excluded_units from public.current_shipment_adjustments where marketplace_id = 'TEST') <> 0 then raise exception 'Correction to zero left stale exclusion'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from pg_class where oid in ('public.shipment_evidence_batches'::regclass, 'public.shipment_adjustment_days'::regclass, 'public.shipment_sync_leases'::regclass) and not relrowsecurity) then raise exception 'RLS missing'; end if;
end $$;
rollback;
