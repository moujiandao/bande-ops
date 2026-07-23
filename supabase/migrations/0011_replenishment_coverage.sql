-- 0011_replenishment_coverage.sql
-- Add the coverage target to the replenishment settings (Module: Replenishment).
--
-- This turns the reorder math from a reorder-POINT top-up into a classic (s,S)
-- policy: `target_coverage_days` is the S (order-up-to) level — how many days of
-- stock to fill to once a SKU trips its reorder point. Like lead_time_days and
-- safety_stock it lives on `replenishment_settings`, so it inherits the same
-- global-default (`sku IS NULL`) + per-SKU-override model and RLS. See ADR-0001.
--
-- Nullable on purpose: existing rows (created before this column) keep working
-- and fall back to the app/global default until a value is set. A concrete
-- value must be positive (0 coverage would silently disable the coverage fill).

alter table public.replenishment_settings
  add column if not exists target_coverage_days integer
    check (target_coverage_days is null or target_coverage_days > 0);
