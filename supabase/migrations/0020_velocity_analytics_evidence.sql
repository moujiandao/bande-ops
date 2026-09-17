-- Retain the evidence needed to distinguish stocked, sellout, restock, and
-- unknown days in Advanced Analytics. Existing rows remain NULL/unknown until
-- the ledger sync reprocesses them; no missing evidence is fabricated.

alter table public.fba_daily_velocity_inputs
  add column if not exists sellable_starting_balance integer,
  add column if not exists starting_balance_valid boolean,
  add column if not exists ending_balance_valid boolean,
  add column if not exists customer_shipments_valid boolean;

comment on column public.fba_daily_velocity_inputs.sellable_starting_balance is
  'Start-of-day SELLABLE warehouse balance from the FBA ledger; null when unavailable.';
comment on column public.fba_daily_velocity_inputs.starting_balance_valid is
  'True only when every contributing SELLABLE row had a parseable starting balance.';
comment on column public.fba_daily_velocity_inputs.ending_balance_valid is
  'True only when every contributing SELLABLE row had a parseable ending balance.';
comment on column public.fba_daily_velocity_inputs.customer_shipments_valid is
  'True only when every contributing SELLABLE row had a parseable customer shipment count.';

create index if not exists fba_daily_velocity_inputs_analytics_history
  on public.fba_daily_velocity_inputs (marketplace_id, activity_date, sku);
