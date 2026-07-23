-- Listing metadata from GET_MERCHANT_LISTINGS_ALL_DATA.
--
-- `open_date` is the listing creation date and is the only signal that
-- separates a genuinely dead SKU from a recently created one that has not sold
-- yet. Without it, the legacy classification would hide new listings.
--
-- Nullable throughout: a SKU present in FBA inventory but absent from the
-- listings report keeps its row with these columns null, rather than being
-- dropped or defaulted to a misleading value.

alter table public.catalog_items
  add column if not exists open_date date,
  add column if not exists listing_status text,
  add column if not exists fulfillment_channel text;

comment on column public.catalog_items.open_date is
  'Listing creation date from GET_MERCHANT_LISTINGS_ALL_DATA. Null when the SKU is absent from the listings report.';
comment on column public.catalog_items.listing_status is
  'Amazon listing status (e.g. Active, Inactive). Null when unknown.';

-- Legacy classification filters on this, and /reorder reads it per page load.
create index if not exists catalog_items_open_date_idx
  on public.catalog_items (marketplace_id, open_date);
