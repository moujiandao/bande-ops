-- AWD reports several quantities; the mirror only stored two, and neither was
-- the one reorder needs.
--
-- `available_distributable_quantity` is stock at AWD free to send to FBA. It is
-- what counts as supply already owned: `replenishment_quantity` covers units
-- that have LEFT AWD and are in transit to FBA, which FBA's own inbound buckets
-- may already report — counting both would double-count them.

alter table public.awd_inventory_levels
  add column if not exists available_distributable_quantity integer,
  add column if not exists inbound_quantity integer;

comment on column public.awd_inventory_levels.available_distributable_quantity is
  'Units at AWD free to send to FBA. The AWD supply figure reorder uses. Null means UNKNOWN, never 0.';
comment on column public.awd_inventory_levels.replenishment_quantity is
  'Units already in transit from AWD to FBA. NOT counted as AWD supply — FBA inbound may already include them.';

-- Which AWD buckets count as usable supply, alongside the existing FBA inbound
-- toggles. Defaults encode the reasoning above: available counts, in-transit
-- does not.
alter table public.replenishment_policy
  add column if not exists count_awd_available boolean not null default true,
  add column if not exists count_awd_replenishment boolean not null default false;
