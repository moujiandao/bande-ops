import type { Campaign, CampaignState } from './types';

/**
 * Pure, I/O-free mappers from the Sponsored Products **v3** API wire shape to
 * our normalized {@link Campaign}. Keeping these pure makes the v3 contract
 * table-testable without touching the network (see `v3.test.ts`).
 *
 * Two things differ from the deprecated v2 shape these mappers replace:
 *   1. `state` is UPPERCASE on the wire ('ENABLED' | 'PAUSED' | 'ARCHIVED').
 *   2. The daily budget is a NESTED object (`budget: { budget, budgetType }`),
 *      not a top-level `dailyBudget`.
 *
 * UNKNOWN-budget invariant: an absent/non-numeric budget maps to `null`
 * (UNKNOWN), NEVER 0 — null means "Amazon gave us no number" and must never be
 * folded into spend math as zero.
 */

/**
 * Map a v3 campaign state to our normalized lowercase {@link CampaignState}.
 * Case-insensitive. Unknown/missing values map to 'paused' — the safe,
 * non-spending default — rather than guessing 'enabled'.
 */
export function parseV3State(raw: string): CampaignState {
  switch (typeof raw === 'string' ? raw.toLowerCase() : '') {
    case 'enabled':
      return 'enabled';
    case 'archived':
      return 'archived';
    case 'paused':
      return 'paused';
    default:
      return 'paused';
  }
}

/** The nested v3 budget object (partial; only the field we map). */
interface V3Budget {
  budget?: unknown;
  budgetType?: unknown;
}

/**
 * Extract the **daily** budget number from the nested v3 budget object.
 * Non-numeric/absent (including NaN/Infinity) maps to `null` (UNKNOWN), NEVER 0.
 * Only DAILY budgets map to our `dailyBudget`; a non-daily type (e.g. LIFETIME)
 * maps to `null` so its amount is never mis-reported as a daily figure. An
 * absent budgetType is treated as DAILY (the SP default).
 */
export function parseV3Budget(budgetObj: unknown): number | null {
  if (budgetObj == null || typeof budgetObj !== 'object') return null;
  const { budget: raw, budgetType } = budgetObj as V3Budget;
  if (typeof budgetType === 'string' && budgetType.toLowerCase() !== 'daily') {
    return null;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}

/** A raw v3 campaign (partial; only the fields we map). */
interface V3Campaign {
  campaignId?: number | string;
  name?: string;
  state?: string;
  budget?: unknown;
}

/**
 * Combine the field mappers into a normalized {@link Campaign}. Accepts
 * `unknown` because it parses untrusted wire data: campaignId is stringified;
 * name defaults to ''; state and budget follow the rules above.
 */
export function parseV3Campaign(raw: unknown): Campaign {
  const c = (raw != null && typeof raw === 'object' ? raw : {}) as V3Campaign;
  return {
    campaignId: c.campaignId != null ? String(c.campaignId) : '',
    name: c.name ?? '',
    state: parseV3State(c.state as string),
    dailyBudget: parseV3Budget(c.budget),
  };
}
