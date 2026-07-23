/**
 * PURE reorder recommender: the highest-stakes math in the app (wrong numbers
 * = wrong money), so it lives in one tested, side-effect-free place.
 *
 * Classic (s, S) inventory policy, carried in INTENT from the legacy
 * `supplier-reorder` tool but simplified to the inputs this app actually has.
 * The two levels are DECOUPLED: one says WHEN to order, the other HOW MUCH.
 *
 *   s = reorderPoint    = dailyDemand * leadTimeDays + safetyStock   (WHEN)
 *   S = targetStock     = dailyDemand * coverageDays                 (HOW MUCH)
 *   orderUpToLevel      = max(S, s)   // never fill below the trigger (S < s edge)
 *   recommendedQty = usableSupply <= s ? ceil(orderUpToLevel - usableSupply) : 0
 *
 * So we only reorder once supply has fallen to the reorder point, and then we
 * fill all the way up to the coverage target (e.g. 90 days of stock). With
 * coverageDays = 0 (or omitted) S collapses to 0, orderUpToLevel floors to s,
 * and this reduces EXACTLY to the old reorder-point top-up — backwards compatible.
 *
 * The non-negotiable rule (carried from supplier-reorder): an item whose usable supply
 * is UNKNOWN (null), or whose demand is UNKNOWN (null), is NEVER given a number.
 * It is surfaced as 'needs-review'. Folding an unknown usable supply in as 0 would
 * manufacture a large, wrong purchase order, exactly the silent corruption this
 * module exists to prevent. null is NEVER coalesced to 0 here.
 */

/** Inputs to a single recommendation. */
export interface RecommendInput {
  /** FBA + selected inbound + AWD + SVD usable supply. null = UNKNOWN; never treated as 0. */
  usableSupply: number | null;
  /** Average daily demand (units/day). null = UNKNOWN (no demand window). */
  dailyDemand: number | null;
  /** Replenishment lead time in days (>= 0). */
  leadTimeDays: number;
  /** Safety stock buffer in units (>= 0). */
  safetyStock: number;
  /**
   * Target days of coverage to order up to (the S in (s,S)). >= 0. Omitted or 0
   * reduces to the legacy reorder-point top-up. Not nullable: an UNKNOWN coverage
   * is a policy/config gap, not per-SKU data, so callers pass the resolved default.
   */
  coverageDays?: number;
}

/** The reasoning shown alongside an 'ok' recommendation (all the math inputs + the derived levels). */
export interface RecommendReasoning {
  usableSupply: number;
  dailyDemand: number;
  leadTimeDays: number;
  safetyStock: number;
  /** Target days of coverage (the S basis). 0 when running as a plain reorder-point top-up. */
  coverageDays: number;
  /** s = dailyDemand * leadTimeDays + safetyStock. The reorder TRIGGER. */
  reorderPoint: number;
  /** S = dailyDemand * coverageDays. The coverage target. */
  targetStock: number;
  /** max(S, s) — what we actually fill up to (never below the trigger). */
  orderUpToLevel: number;
}

/** A computed recommendation, or a flag that the SKU cannot be computed. */
export type Recommendation =
  | { status: 'ok'; recommendedQty: number; reasoning: RecommendReasoning }
  | { status: 'needs-review'; reason: string };

/** A finite, non-negative number, the only shape the math accepts for the policy inputs. */
function isNonNegativeFinite(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/**
 * Recommend a reorder quantity for one SKU, or flag it for review.
 *
 * Order of checks matters: UNKNOWN (null) usable supply or demand short-circuits to
 * needs-review BEFORE any arithmetic, so a null can never reach the math and be
 * coerced to 0. Negative/NaN/Infinite policy inputs are also rejected (a bad
 * input must surface, not silently produce a wrong number).
 */
export function recommend(input: RecommendInput): Recommendation {
  const { usableSupply, dailyDemand, leadTimeDays, safetyStock } = input;
  const coverageDays = input.coverageDays ?? 0;

  // UNKNOWN usable supply: cannot compute, must not fabricate. The spine of the rule.
  if (usableSupply === null) {
    return { status: 'needs-review', reason: 'unknown-usable-supply' };
  }
  // UNKNOWN demand: cannot forecast (distinct from a real all-zero history).
  if (dailyDemand === null) {
    return { status: 'needs-review', reason: 'unknown-demand' };
  }

  // Guard non-finite / negative inputs. These should never produce a numeric
  // recommendation. Surface them for review rather than emit a wrong number.
  if (!isNonNegativeFinite(usableSupply)) {
    return { status: 'needs-review', reason: 'invalid-usable-supply' };
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
  if (!isNonNegativeFinite(coverageDays)) {
    return { status: 'needs-review', reason: 'invalid-coverage' };
  }

  // s = reorder point (WHEN). S = coverage target (HOW MUCH).
  const reorderPoint = dailyDemand * leadTimeDays + safetyStock;
  const targetStock = dailyDemand * coverageDays;
  // Never fill below the trigger: if coverage is short of the lead-time need
  // (S < s), order up to s so we don't reorder into an immediate stockout.
  const orderUpToLevel = Math.max(targetStock, reorderPoint);
  // Defense in depth: the per-input guards above don't catch a product that
  // overflows to Infinity. A non-finite level must surface, not emit garbage.
  if (!Number.isFinite(orderUpToLevel)) {
    return { status: 'needs-review', reason: 'invalid-reorder-point' };
  }

  // Trigger on the reorder point (s), then fill to the order-up-to level.
  // Demand may be fractional (units/day), so round the order quantity UP:
  // never under-order and leave the SKU short.
  const recommendedQty =
    usableSupply <= reorderPoint
      ? Math.ceil(orderUpToLevel - usableSupply)
      : 0;

  return {
    status: 'ok',
    recommendedQty,
    reasoning: {
      usableSupply,
      dailyDemand,
      leadTimeDays,
      safetyStock,
      coverageDays,
      reorderPoint,
      targetStock,
      orderUpToLevel,
    },
  };
}
