-- Synced mirror field from SP-API reservedQuantity.pendingTransshipmentQuantity.
-- Leave existing rows NULL until a real inventory sync supplies the quantity.
-- A default of zero would silently understate on-hand stock before that sync.
alter table public.inventory_levels
  add column if not exists fc_transfer_quantity integer
  check (fc_transfer_quantity >= 0);

comment on column public.inventory_levels.fc_transfer_quantity is
  'Buyable units transferring between Amazon fulfillment centers. Included in the API reserved total. On-hand = fulfillable_quantity + fc_transfer_quantity; NULL means unknown until synced.';
