/**
 * Pure, I/O-free DECISION-SUPPORT recommendations for a Sponsored Products
 * campaign (Module 2: Ads, slice A5 — recommendations + guarded write-back).
 *
 * This is the policy layer that sits between the actionable `flags` (from
 * `classifyCampaign`) and the human. It turns "this campaign is wasting spend"
 * into "here is the concrete change you could make" — but it NEVER writes to
 * Amazon and NEVER decides on its own. A human reviews each recommendation and
 * initiates the write from the UI (owner-gated). There is deliberately no
 * automated/rule-based write path anywhere downstream of this function.
 *
 * INVARIANTS (mirror classify.ts / metrics.ts):
 *   - UNKNOWN-safe: a null cost/sales (or a divide-by-zero ACOS) NEVER yields a
 *     recommendation. We re-verify each trigger against the RAW metrics, so even
 *     a stale or incorrect flag passed in cannot trip a pause or a budget cut.
 *   - paused-safe: only ENABLED campaigns get recommendations. A paused/archived
 *     campaign already had its action taken; recommending more is noise.
 *   - suggestedBudget is emitted ONLY when the current budget is KNOWN (> 0). A
 *     null/UNKNOWN budget still produces the recommendation (the actionable
 *     metric is ACOS, which is known) — we just can't suggest a number.
 *
 * Triggers (the two specified for A5):
 *   - spend-no-sales (cost > 0 AND a true zero of sales) -> suggest 'pause'.
 *   - high-acos (computed ACOS strictly above target)    -> suggest 'lower-budget'.
 *
 * 'raise-budget' is part of the recommendation/action vocabulary (the owner can
 * raise a budget manually from the UI, and the audit log records it), but it is
 * intentionally NOT auto-recommended here: scaling up safely needs a
 * budget-constrained signal classify does not yet produce.
 */

import { acos } from './metrics';
import type { CampaignFlag } from './classify';
import type { CampaignState } from './types';

/** The kinds of change a recommendation (and the write seam) can express. */
export type RecommendationKind = 'pause' | 'lower-budget' | 'raise-budget';

/** A single, human-reviewable suggested change. Never auto-applied. */
export interface Recommendation {
  kind: RecommendationKind;
  /** Plain-language justification shown to the operator. */
  reason: string;
  /**
   * Concrete suggested daily budget for a budget change. Present ONLY when the
   * current budget is KNOWN; absent (undefined) when the budget is UNKNOWN.
   */
  suggestedBudget?: number;
}

export interface RecommendInput {
  state: CampaignState;
  /** Ad spend over the window. null = UNKNOWN; never treated as 0. */
  cost: number | null;
  /** Attribution-windowed sales. null = UNKNOWN; never treated as 0. */
  sales: number | null;
  /** Daily budget. null = UNKNOWN; never treated as 0. */
  dailyBudget: number | null;
  /** Target ACOS as a RATIO (0.25 = 25%). null = not set (no high-acos). */
  acosTarget: number | null;
  /** Actionable flags from classifyCampaign — the trigger set. */
  flags: CampaignFlag[];
}

/**
 * Fraction of the current daily budget to suggest for a high-ACOS campaign:
 * throttle an inefficient campaign by cutting spend 25%. A conservative,
 * decision-support heuristic — the operator can pick any number; this is just a
 * sensible default to pre-fill. (Alternative rejected: scaling the budget by
 * target/ACOS — conflates budget, a spend cap, with ACOS, an efficiency ratio.)
 */
const LOWER_BUDGET_FACTOR = 0.75;

/** A finite-number guard: rejects null, NaN, and ±Infinity. */
function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** Round to cents so a suggested budget is a clean currency amount. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Map a campaign's flags + raw metrics to zero or more suggested changes.
 * Pure; returns recommendations in canonical order (pause, then lower-budget).
 */
export function recommendCampaignActions(
  input: RecommendInput,
): Recommendation[] {
  // paused-safe: only enabled campaigns are actionable.
  if (input.state !== 'enabled') return [];

  const { cost, sales, dailyBudget, acosTarget } = input;
  const flags = new Set(input.flags);
  const recs: Recommendation[] = [];

  // spend-no-sales -> pause. Re-verify on raw metrics (KNOWN positive spend with
  // a true zero of sales) so an UNKNOWN or a stale flag never triggers a pause.
  if (
    flags.has('spend-no-sales') &&
    isFiniteNumber(cost) &&
    cost > 0 &&
    sales === 0
  ) {
    recs.push({
      kind: 'pause',
      reason: `Spent ${cost} with zero attributed sales — consider pausing until the targeting or creative is fixed.`,
    });
  }

  // high-acos -> lower-budget. Re-compute ACOS and re-check it is strictly above
  // target; acos() already returns null for any UNKNOWN input or zero sales, so
  // this can never fire on UNKNOWN data.
  if (flags.has('high-acos')) {
    const computedAcos = acos(cost, sales);
    if (
      computedAcos !== null &&
      isFiniteNumber(acosTarget) &&
      computedAcos > acosTarget
    ) {
      const rec: Recommendation = {
        kind: 'lower-budget',
        reason: `ACOS ${(computedAcos * 100).toFixed(1)}% is above your ${(
          acosTarget * 100
        ).toFixed(1)}% target — consider lowering the daily budget.`,
      };
      // Only suggest a number when the current budget is KNOWN and positive.
      if (isFiniteNumber(dailyBudget) && dailyBudget > 0) {
        rec.suggestedBudget = roundCurrency(dailyBudget * LOWER_BUDGET_FACTOR);
      }
      recs.push(rec);
    }
  }

  return recs;
}
