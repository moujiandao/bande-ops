-- 0015_svd_units_per_box.sql
-- SVD pack size, so SVD stock can be compared with FBA and AWD.
--
-- SVD reports inventory in BOXES. FBA and AWD both report UNITS. Until this
-- column exists the reorder path adds SVD box counts straight into a
-- unit-denominated supply total and then divides by a unit-denominated daily
-- demand, understating supply for every SKU carrying SVD stock. See
-- docs/superpowers/specs/2026-07-23-units-per-box-design.md.
--
-- Named `svd_units_per_box`, NOT `units_per_box`: only SVD is box-denominated,
-- and a source-neutral name invites a future reader to apply the factor to AWD
-- as well, which would recreate the same bug in the opposite direction. The
-- scope belongs in the name.
--
-- Deliberately does NOT participate in the global-default (`sku IS NULL`)
-- fallback that lead_time_days, safety_stock, and target_coverage_days use.
-- Those are policy choices where one reasonable number applies broadly; a pack
-- size is a physical fact that differs per product, so a global default would
-- not approximate anything — it would silently rewrite the supply of every SKU
-- without an override into a plausible-looking wrong number. Rows on the global
-- default record simply leave this column unset; nothing reads it there.
--
-- Nullable is load-bearing. NULL means "we do not know this SKU's pack size",
-- which is exactly the state the blocking rule keys on: a SKU with non-zero SVD
-- boxes and no factor yields `Needs review`, never a guess. Per the project rule,
-- UNKNOWN is never folded in as a number. A concrete value must be positive —
-- zero or negative units per box is meaningless and would silently zero out or
-- invert real stock.

alter table public.replenishment_settings
  add column if not exists svd_units_per_box integer
    check (svd_units_per_box is null or svd_units_per_box > 0);

comment on column public.replenishment_settings.svd_units_per_box is
  'Sellable units per SVD box for this SKU. Per-SKU only — never falls back to the global default row. Null means UNKNOWN: blocks the reorder recommendation when the SKU has non-zero SVD stock, and is ignored when it has none.';
