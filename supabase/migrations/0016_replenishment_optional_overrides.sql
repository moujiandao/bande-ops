-- 0016_replenishment_optional_overrides.sql
-- Make lead time and safety stock optional on per-SKU rows.
--
-- replenishment_settings holds one global default row (sku IS NULL) plus per-SKU
-- override rows. Until now lead_time_days and safety_stock were NOT NULL on
-- every row, so creating a per-SKU row to hold ANY single override (a coverage
-- target, and now an svd_units_per_box) forced the writer to also assert a lead
-- time and a safety stock. Those asserted values then act as permanent overrides
-- in lib/reorder/service.ts, silently detaching that SKU from the global default.
--
-- target_coverage_days is already nullable with exactly this meaning ("unset =
-- inherit the default"). This migration extends the same shape to lead time and
-- safety stock, so a per-SKU row can carry only the fields it actually overrides
-- and inherit the rest. See docs/superpowers/specs/2026-07-23-units-per-box-design.md
-- and ADR-0001.
--
-- The catch: the global DEFAULT row is the thing every SKU inherits from, so it
-- must stay complete. A check constraint enforces that null is legal only when a
-- sku is present — the default row (sku IS NULL) must supply both values. This
-- makes an incomplete default unrepresentable at the database rather than merely
-- discouraged in application code.
--
-- Backwards-compatible: the existing rows already carry both values and satisfy
-- the constraint unchanged; existing code paths that always write both continue
-- to work.

alter table public.replenishment_settings
  alter column lead_time_days drop not null,
  alter column safety_stock   drop not null;

-- Legal only if: a per-SKU row (sku is not null) may omit either value, but the
-- global default row (sku is null) must supply both. Named so a failed insert
-- points straight back to this rule.
alter table public.replenishment_settings
  add constraint replenishment_settings_default_row_complete
    check (
      sku is not null
      or (lead_time_days is not null and safety_stock is not null)
    );

comment on column public.replenishment_settings.lead_time_days is
  'Lead time in days. Required on the global default row (sku IS NULL); on a per-SKU row, null means inherit the default.';
comment on column public.replenishment_settings.safety_stock is
  'Safety stock in units. Required on the global default row (sku IS NULL); on a per-SKU row, null means inherit the default.';
