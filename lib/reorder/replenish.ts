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
 * Units at or heading to Amazon that count toward covering demand: FBA
 * fulfillable + FBA incoming (the policy-counted inbound, already summed in
 * `service.ts`) + AWD.
 *
 * SVD is excluded deliberately: it cannot fulfil a customer order, so it
 * reduces future reorder need without extending current cover. Reserved and
 * unfulfillable FBA stock are likewise excluded — they are not available to
 * cover demand — even though the breakdown displays them.
 */
function onAmazonSide(row: RecommendationRow): number {
  return (
    (row.sources.fba ?? 0) + (row.sources.fbaInbound ?? 0) + (row.sources.awd ?? 0)
  );
}

/**
 * Days of cover from stock at or heading to Amazon (FBA fulfillable + FBA
 * incoming + AWD).
 */
export function amazonSideCover(row: RecommendationRow): number | null {
  if (row.dailyDemand === null || row.dailyDemand <= 0) return null;
  if (row.sources.fba === null && row.sources.awd === null) return null;
  return Math.floor(onAmazonSide(row) / row.dailyDemand);
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
  const shortfall = Math.ceil(row.dailyDemand * targetDays - onAmazonSide(row));
  if (shortfall <= 0) return null;
  return Math.min(shortfall, svd);
}

/** Coverage target that defines "low" for the SVD→FBA replenish list. */
export const REPLENISH_TARGET_DAYS = 30;
