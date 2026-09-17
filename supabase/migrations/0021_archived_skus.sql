-- Keep operator-hidden SKUs separate from synced Amazon mirrors.
--
-- A row means the SKU is archived from the Reorder and Catalog views. This is
-- authoritative operational state: Amazon syncs never insert, update, or delete
-- it. Removing the row unarchives the SKU.

create table if not exists public.archived_skus (
  marketplace_id text not null default 'ATVPDKIKX0DER',
  sku text not null,
  archived_at timestamptz not null default now(),
  archived_by uuid references auth.users (id) on delete set null,
  primary key (marketplace_id, sku)
);

comment on table public.archived_skus is
  'Operational layer (not a synced mirror): SKUs hidden from Reorder and Catalog until an authenticated user unarchives them.';

alter table public.archived_skus enable row level security;

create policy "archived_skus_select_authenticated"
  on public.archived_skus
  for select
  to authenticated
  using (true);

create policy "archived_skus_insert_authenticated"
  on public.archived_skus
  for insert
  to authenticated
  with check (archived_by = auth.uid());

create policy "archived_skus_update_authenticated"
  on public.archived_skus
  for update
  to authenticated
  using (true)
  with check (archived_by = auth.uid());

create policy "archived_skus_delete_authenticated"
  on public.archived_skus
  for delete
  to authenticated
  using (true);
