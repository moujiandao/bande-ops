-- Last date a SKU actually shipped to a customer.
--
-- Velocity alone cannot answer "has this sold recently": a SKU with no sales
-- has no velocity row at all, which is indistinguishable from one that failed
-- to sync. Recording the last sale date lets the legacy classification tell a
-- dead SKU from a new listing, paired with catalog_items.open_date.
--
-- Null means "no sale within the ledger window", not "never sold".

alter table public.sales_velocity
  add column if not exists last_sold_date date;

comment on column public.sales_velocity.last_sold_date is
  'Most recent date with customer shipments inside the ledger window. Null when the SKU did not sell in that window.';
