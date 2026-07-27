-- 0017_replenishment_box_name.sql
-- Per-SKU box name: the operator's own label for the physical product/box
-- (e.g. "template 1 (2pack)", "setA + booklet", "babyboy").
--
-- This is OUR operational layer — authoritative, user-authored, not a synced
-- mirror. It is a free-text label the operator assigns to each SKU, shown on the
-- replenish list so a picker knows which box to pull, and editable in Settings.
-- It lives on replenishment_settings alongside svd_units_per_box, so it inherits
-- the same per-SKU row model, RLS, and unique index. See ADR-0001.
--
-- Per-SKU ONLY, like svd_units_per_box: a label is a per-product fact, so a value
-- on the global default row (sku IS NULL) is meaningless and ignored. Nullable:
-- a SKU with no assigned label simply has none (shown as an em dash), which is a
-- fact, not UNKNOWN — nothing computes on this field, so there is no blocking
-- semantics to preserve. Free text, so no check constraint.

alter table public.replenishment_settings
  add column if not exists box_name text;

comment on column public.replenishment_settings.box_name is
  'Operator-assigned label for the SKU''s physical box/product (per-SKU only; ignored on the global default row). Free text, shown on the replenish list and editable in Settings. Null means no label assigned.';
