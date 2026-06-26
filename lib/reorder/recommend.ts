/**
 * PURE reorder recommender — the highest-stakes math in the app (wrong numbers
 * = wrong money), so it lives in one tested, side-effect-free place.
 *
 * Textbook reorder-point logic, carried in INTENT from the legacy
 * `supplier-reorder` tool but simplified to the inputs this app actually has:
 *
 *   reorderPoint  = dailyDemand * leadTimeDays + safetyStock
 *   recommendedQty = onHand <= reorderPoint ? (reorderPoint - onHand) : 0
 *
 * The non-negotiable rule (carried from supplier-reorder): an item whose on-hand
 * is UNKNOWN (null), or whose demand is UNKNOWN (null), is NEVER given a number.
 * It is surfaced as 'needs-review'. Folding an unknown on-hand in as 0 would
 * manufacture a large, wrong purchase order — exactly the silent corruption this
 * module exists to prevent. null is NEVER coalesced to 0 here.
 */

/** Inputs to a single recommendation. */
export interface RecommendInput {
  /** Sellable on-hand. null = UNKNOWN (Amazon gave no number); never treated as 0. */
  onHand: number | null;
  /** Average daily demand (units/day). null = UNKNOWN (no demand window). */
  dailyDemand: number | null;
  /** Replenishment lead time in days (>= 0). */
  leadTimeDays: number;
  /** Safety stock buffer in units (>= 0). */
  safetyStock: number;
}

/** The reasoning shown alongside an 'ok' recommendation (all the math inputs + the derived point). */
export interface RecommendReasoning {
  onHand: number;
  dailyDemand: number;
  leadTimeDays: number;
  safetyStock: number;
  /** dailyDemand * leadTimeDays + safetyStock. */
  reorderPoint: number;
}

/** A computed recommendation, or a flag that the SKU cannot be computed. */
export type Recommendation =
  | { status: 'ok'; recommendedQty: number; reasoning: RecommendReasoning }
  | { status: 'needs-review'; reason: string };

/** A finite, non-negative number — the only shape the math accepts for the policy inputs. */
function isNonNegativeFinite(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/**
 * Recommend a reorder quantity for one SKU, or flag it for review.
 *
 * Order of checks matters: UNKNOWN (null) on-hand or demand short-circuits to
 * needs-review BEFORE any arithmetic, so a null can never reach the math and be
 * coerced to 0. Negative/NaN/Infinite policy inputs are also rejected (a bad
 * input must surface, not silently produce a wrong number).
 */
export function recommend(input: RecommendInput): Recommendation {
  const { onHand, dailyDemand, leadTimeDays, safetyStock } = input;

  // UNKNOWN on-hand: cannot compute, must not fabricate. The spine of the rule.
  if (onHand === null) {
    return { status: 'needs-review', reason: 'unknown-on-hand' };
  }
  // UNKNOWN demand: cannot forecast (distinct from a real all-zero history).
  if (dailyDemand === null) {
    return { status: 'needs-review', reason: 'unknown-demand' };
  }

  // Guard non-finite / negative inputs. These should never produce a numeric
  // recommendation — surface them for review rather than emit a wrong number.
  if (!isNonNegativeFinite(onHand)) {
    return { status: 'needs-review', reason: 'invalid-on-hand' };
  }
  if (!isNonNegativeFinite(dailyDemand)) {
    return { status: 'needs-review', reason: 'invalid-demand' };
  }
  if (!isNonNegativeFinite(leadTimeDays)) {
    return { status: 'needs-review', reason: 'invalid-lead-time' };
  }
  if (!isNonNegativeFinite(safetyStock)) {
    return { status: 'needs-review', reason: 'invalid-safety-stock' };
  }

  const reorderPoint = dailyDemand * leadTimeDays + safetyStock;
  // Defense in depth: the per-input guards above don't catch a product that
  // overflows to Infinity. A non-finite reorder point must surface, not emit a
  // garbage quantity.
  if (!Number.isFinite(reorderPoint)) {
    return { status: 'needs-review', reason: 'invalid-reorder-point' };
  }

  // At or below the reorder point -> order back up to it. Demand may be
  // fractional (units/day), so round the order quantity UP: never under-order
  // and leave the SKU short of its reorder point.
  const recommendedQty =
    onHand <= reorderPoint ? Math.ceil(reorderPoint - onHand) : 0;

  return {
    status: 'ok',
    recommendedQty,
    reasoning: { onHand, dailyDemand, leadTimeDays, safetyStock, reorderPoint },
  };
}
