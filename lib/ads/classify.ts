/**
 * Pure, I/O-free classification of a Sponsored Products campaign into actionable
 * "wasted-spend" flags (Module 2: Ads, slice A4 — "make spend actionable").
 *
 * This is decision-support only: it never writes to Amazon. It looks at a
 * campaign's state, spend (cost), sales, daily budget, and the user's ACOS
 * target and returns the flags an operator should act on.
 *
 * UNKNOWN invariant (mirrors UNKNOWN-stock / UNKNOWN-budget): a null cost, sales,
 * budget, or target is UNKNOWN — "Amazon (or the operator) gave us no number".
 * UNKNOWN data must NEVER produce a false 'high-acos' or 'spend-no-sales'. We
 * only flag on numbers we actually have.
 *
 * Actionability gate: flags are only emitted for ENABLED campaigns. A
 * paused/archived campaign isn't actively wasting spend you can still adjust —
 * the action (pausing) was already taken — so surfacing historical waste there
 * is noise. This is why `state` is an input. (Alternative rejected: flag
 * regardless of state — noisier and less actionable.)
 */

import { acos } from './metrics';
import type { CampaignState } from './types';

/** The wasted-spend signals surfaced on /ads, in their canonical emit order. */
export type CampaignFlag = 'high-acos' | 'spend-no-sales' | 'underspending';

export interface ClassifyInput {
  state: CampaignState;
  /** Ad spend over the reporting window. null = UNKNOWN; never treated as 0. */
  cost: number | null;
  /** Attribution-windowed sales. null = UNKNOWN; never treated as 0. */
  sales: number | null;
  /** Daily budget. null = UNKNOWN; never treated as 0. */
  dailyBudget: number | null;
  /**
   * Target ACOS as a RATIO (0.25 = 25%), comparable to acos() output. null =
   * not set by the operator yet (no 'high-acos' flagging possible).
   */
  acosTarget: number | null;
}

/**
 * Below this fraction of the daily budget, an enabled campaign is "underspending".
 * Heuristic: cost is a windowed total and dailyBudget is per-day, so this is a
 * rough delivery signal (e.g. a budget set but barely/never spending), not a
 * precise pacing calculation. Conservative on purpose.
 */
const UNDERSPEND_FRACTION = 0.25;

/** A finite-number guard: rejects null, NaN, and ±Infinity. */
function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * Classify a campaign into zero or more actionable flags. Pure; returns flags in
 * canonical order (high-acos, spend-no-sales, underspending). Multiple flags can
 * apply at once — they describe orthogonal facets of the same campaign.
 */
export function classifyCampaign(input: ClassifyInput): CampaignFlag[] {
  const flags: CampaignFlag[] = [];

  // Only enabled campaigns are actionable spend. Paused/archived -> no flags.
  if (input.state !== 'enabled') return flags;

  const { cost, sales, dailyBudget, acosTarget } = input;

  // high-acos: computed ACOS strictly above target. acos() already returns null
  // (UNKNOWN) for any null input or zero sales, so an UNKNOWN never trips this.
  const computedAcos = acos(cost, sales);
  if (
    computedAcos !== null &&
    isFiniteNumber(acosTarget) &&
    computedAcos > acosTarget
  ) {
    flags.push('high-acos');
  }

  // spend-no-sales: real spend with a real zero of sales. Both must be KNOWN —
  // a null cost or null sales is UNKNOWN and must not trip this.
  if (isFiniteNumber(cost) && isFiniteNumber(sales) && cost > 0 && sales === 0) {
    flags.push('spend-no-sales');
  }

  // underspending (optional): an enabled campaign with a real budget that is
  // barely spending against it. Budget and cost must be KNOWN; budget must be
  // positive (can't underspend a zero budget).
  if (
    isFiniteNumber(dailyBudget) &&
    dailyBudget > 0 &&
    isFiniteNumber(cost) &&
    cost < dailyBudget * UNDERSPEND_FRACTION
  ) {
    flags.push('underspending');
  }

  return flags;
}
