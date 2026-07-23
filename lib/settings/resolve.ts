/**
 * Pure resolution of the *effective* replenishment setting for a SKU.
 *
 * Replenishment inputs (lead time, safety stock, coverage target) come in two
 * layers: a single global default and an optional per-SKU override. This helper
 * collapses the two into the values the reorder math should actually use, with
 * the per-SKU value winning field-by-field when present.
 *
 * Kept pure (no I/O) so it can be unit-tested in isolation and reused anywhere
 * the effective setting is needed.
 */

export type ReplenishmentValues = {
  leadTimeDays: number;
  safetyStock: number;
  /** Target days of coverage to order up to (the S in the (s,S) reorder policy). */
  coverageDays: number;
};

/**
 * A per-SKU override may be absent entirely, or present but only override some
 * fields — an unset field falls back to the default.
 */
export type PartialReplenishment = Partial<ReplenishmentValues> | null | undefined;

/**
 * Resolve the effective setting: per-SKU override wins per field, otherwise the
 * default applies.
 *
 * Uses nullish coalescing deliberately: a literal 0 (e.g. zero safety stock) is
 * a meaningful override and must NOT fall through to the default — only
 * null/undefined (i.e. "not set") does.
 */
export function effectiveSetting(
  perSku: PartialReplenishment,
  defaults: ReplenishmentValues,
): ReplenishmentValues {
  return {
    leadTimeDays: perSku?.leadTimeDays ?? defaults.leadTimeDays,
    safetyStock: perSku?.safetyStock ?? defaults.safetyStock,
    coverageDays: perSku?.coverageDays ?? defaults.coverageDays,
  };
}
