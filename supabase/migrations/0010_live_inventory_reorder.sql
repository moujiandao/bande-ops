create table if not exists public.source_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  marketplace_id text not null default 'ATVPDKIKX0DER',
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  row_count integer,
  error_summary text
);

create table if not exists public.source_sync_state (
  source text not null,
  marketplace_id text not null default 'ATVPDKIKX0DER',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  current_success_run_id uuid references public.source_sync_runs(id),
  status text not null check (status in ('running', 'success', 'failed', 'stale')),
  row_count integer,
  error_summary text,
  updated_at timestamptz not null default now(),
  primary key (source, marketplace_id)
);

alter table public.inventory_levels
  add column if not exists fulfillable_quantity integer,
  add column if not exists inbound_working_quantity integer,
  add column if not exists inbound_shipped_quantity integer,
  add column if not exists inbound_receiving_quantity integer,
  add column if not exists reserved_quantity integer,
  add column if not exists researching_quantity integer,
  add column if not exists unfulfillable_quantity integer,
  add column if not exists sync_run_id uuid references public.source_sync_runs(id);

create table if not exists public.awd_inventory_levels (
  marketplace_id text not null default 'ATVPDKIKX0DER',
  sku text not null,
  fn_sku text,
  replenishment_quantity integer,
  total_quantity integer,
  synced_at timestamptz not null default now(),
  sync_run_id uuid references public.source_sync_runs(id),
  primary key (marketplace_id, sku)
);

create table if not exists public.fba_daily_velocity_inputs (
  marketplace_id text not null default 'ATVPDKIKX0DER',
  sku text not null,
  fn_sku text,
  activity_date date not null,
  customer_shipments integer not null,
  sellable_ending_balance integer,
  is_in_stock boolean not null,
  report_id text not null,
  sync_run_id uuid references public.source_sync_runs(id),
  primary key (marketplace_id, sku, activity_date)
);

create table if not exists public.sales_velocity (
  marketplace_id text not null default 'ATVPDKIKX0DER',
  sku text not null,
  fn_sku text,
  units_shipped integer,
  in_stock_sample_days integer not null,
  lookback_days_used integer not null,
  daily_velocity numeric,
  status text not null check (status in ('ok', 'unknown')),
  calculated_at timestamptz not null default now(),
  sync_run_id uuid references public.source_sync_runs(id),
  primary key (marketplace_id, sku)
);

create table if not exists public.svd_inventory_levels (
  svd_item_id text primary key,
  sku text,
  fn_sku text,
  description text not null,
  quantity integer,
  raw_availability text not null,
  refreshed_at timestamptz not null default now(),
  sync_run_id uuid references public.source_sync_runs(id)
);

create table if not exists public.inventory_source_mappings (
  id uuid primary key default gen_random_uuid(),
  marketplace_id text not null default 'ATVPDKIKX0DER',
  amazon_sku text not null,
  fn_sku text,
  svd_item_id text,
  mapping_source text not null check (mapping_source in ('fn_sku', 'sku', 'manual')),
  status text not null check (status in ('active', 'needs_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_source_mappings_unique_source
  on public.inventory_source_mappings (marketplace_id, amazon_sku, coalesce(svd_item_id, ''));

create table if not exists public.replenishment_policy (
  marketplace_id text primary key default 'ATVPDKIKX0DER',
  velocity_sample_in_stock_days integer not null default 90 check (velocity_sample_in_stock_days > 0),
  velocity_max_lookback_days integer not null default 365 check (velocity_max_lookback_days > 0),
  fulfillment_mode text not null default 'fba_only' check (fulfillment_mode = 'fba_only'),
  svd_mode text not null default 'replenishment_only' check (svd_mode = 'replenishment_only'),
  unknown_stock_mode text not null default 'needs_review' check (unknown_stock_mode = 'needs_review'),
  stale_source_mode text not null default 'needs_review' check (stale_source_mode = 'needs_review'),
  count_inbound_working boolean not null default false,
  count_inbound_shipped boolean not null default true,
  count_inbound_receiving boolean not null default true,
  updated_at timestamptz not null default now(),
  check (velocity_sample_in_stock_days <= velocity_max_lookback_days)
);

alter table public.source_sync_runs enable row level security;
alter table public.source_sync_state enable row level security;
alter table public.awd_inventory_levels enable row level security;
alter table public.fba_daily_velocity_inputs enable row level security;
alter table public.sales_velocity enable row level security;
alter table public.svd_inventory_levels enable row level security;
alter table public.inventory_source_mappings enable row level security;
alter table public.replenishment_policy enable row level security;

create policy "source_sync_runs_select_authenticated" on public.source_sync_runs for select to authenticated using (true);
create policy "source_sync_state_select_authenticated" on public.source_sync_state for select to authenticated using (true);
create policy "awd_inventory_levels_select_authenticated" on public.awd_inventory_levels for select to authenticated using (true);
create policy "fba_daily_velocity_inputs_select_authenticated" on public.fba_daily_velocity_inputs for select to authenticated using (true);
create policy "sales_velocity_select_authenticated" on public.sales_velocity for select to authenticated using (true);
create policy "svd_inventory_levels_select_authenticated" on public.svd_inventory_levels for select to authenticated using (true);
create policy "inventory_source_mappings_select_authenticated" on public.inventory_source_mappings for select to authenticated using (true);
create policy "inventory_source_mappings_insert_authenticated" on public.inventory_source_mappings for insert to authenticated with check (true);
create policy "inventory_source_mappings_update_authenticated" on public.inventory_source_mappings for update to authenticated using (true) with check (true);
create policy "replenishment_policy_select_authenticated" on public.replenishment_policy for select to authenticated using (true);
create policy "replenishment_policy_insert_authenticated" on public.replenishment_policy for insert to authenticated with check (true);
create policy "replenishment_policy_update_authenticated" on public.replenishment_policy for update to authenticated using (true) with check (true);
