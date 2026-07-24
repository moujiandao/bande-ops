/**
 * SVD → FBA replenishment math.
 *
 * Lives here rather than in the reorder table component because it is reorder
 * math, not presentation: it needs unit tests, and while it sat in a client
 * component it silently acquired the box/unit defect that `supply.ts` was fixed
 * for.
 *
 * Every quantity below is in UNITS. `row.sources.svd` is already converted from
 * SVD's boxes by `service.ts`; nothing here multiplies anything.
 */

import type { RecommendationRow } from './service';

/**
 * Days of cover from stock at or heading to Amazon.
 *
 * The amazon-side figure (`sources.amazonSideCounted`) is assembled in
 * `service.ts`, where the policy lives: FBA fulfillable + policy-counted FBA
 * incoming + policy-counted AWD. It must NOT be reassembled here — doing so from
 * `sources.awd` (which shows ALL AWD, including in-transit units FBA inbound
 * already reports) would double-count.
 *
 * SVD is excluded deliberately: it cannot fulfil a customer order, so it reduces
 * future reorder need without extending current cover. Reserved and
 * unfulfillable FBA stock are likewise excluded, though the breakdown shows them.
 */
export function amazonSideCover(row: RecommendationRow): number | null {
  if (row.dailyDemand === null || row.dailyDemand <= 0) return null;
  if (row.sources.fba === null && row.sources.awd === null) return null;
  return Math.floor(row.sources.amazonSideCounted / row.dailyDemand);
}

/**
 * Units to send from SVD to reach the coverage target, capped by what SVD
 * actually has. Never suggests shipping stock that is not there.
 *
 * A null `sources.svd` means the unit count could not be derived — an unset
 * pack size, or an unreadable quantity — and yields null rather than a guess.
 */
export function suggestedShipQty(
  row: RecommendationRow,
  targetDays: number,
): number | null {
  if (row.dailyDemand === null || row.dailyDemand <= 0) return null;
  const svd = row.sources.svd;
  if (svd === null || svd <= 0) return null;
  const shortfall = Math.ceil(
    row.dailyDemand * targetDays - row.sources.amazonSideCounted,
  );
  if (shortfall <= 0) return null;
  return Math.min(shortfall, svd);
}

/** Coverage target that defines "low" for the SVD→FBA replenish list. */
export const REPLENISH_TARGET_DAYS = 30;
