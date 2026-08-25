-- Store-wide target used only by the SVD-to-FBA transfer recommendation.
-- It is deliberately separate from replenishment_settings.target_coverage_days,
-- which controls supplier reorder quantities and can vary per SKU.

alter table public.replenishment_policy
  add column if not exists svd_to_fba_target_days integer not null default 30
    check (svd_to_fba_target_days in (30, 60, 90, 180));

comment on column public.replenishment_policy.svd_to_fba_target_days is
  'Days of Amazon-side cover targeted by the SVD-to-FBA transfer recommendation.';
