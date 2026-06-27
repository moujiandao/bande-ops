/**
 * Domain + row shapes for the Amazon Advertising API client (Module 2: Ads).
 *
 * The Advertising API is a SEPARATE API from SP-API (own host, own LWA client,
 * own profile-scoped auth), so this module is independent of `lib/amazon`. The
 * marketplace dimension, however, is a SHARED concern — we reuse
 * `MarketplaceId` / `DEFAULT_MARKETPLACE` from `@/lib/amazon/types` rather than
 * redefining them.
 *
 * UNKNOWN-budget convention (mirrors the UNKNOWN-stock rule):
 *   When Amazon reports a campaign's daily budget as non-numeric/unavailable,
 *   callers MUST surface it as `dailyBudget: null` (UNKNOWN). null is
 *   semantically distinct from a true 0 — it means "Amazon did not give us a
 *   number" and must never be folded into spend math as 0.
 */

// Re-export the shared marketplace primitives so Ads modules import them from
// one place (this module) without reaching into SP-API internals.
export {
  type MarketplaceId,
  type Marketplace,
  MARKETPLACES,
  DEFAULT_MARKETPLACE,
} from '@/lib/amazon/types';

/** Lifecycle state of a Sponsored Products campaign. */
export type CampaignState = 'enabled' | 'paused' | 'archived';

/**
 * Minimal Sponsored Products campaign shape (PII-free).
 *
 * `dailyBudget: null` means UNKNOWN (Amazon reported non-numeric/unavailable).
 * Never represent UNKNOWN as 0.
 */
export interface Campaign {
  campaignId: string;
  name: string;
  state: CampaignState;
  /** null = UNKNOWN (see UNKNOWN-budget convention above). */
  dailyBudget: number | null;
}

/**
 * A row of the `public.ads_campaigns` synced mirror, exactly as written to
 * Postgres. snake_case to match the column names; `daily_budget` is nullable
 * (NULL = UNKNOWN, never 0); `synced_at` is an ISO-8601 string.
 */
export interface AdsCampaignRow {
  marketplace_id: string;
  campaign_id: string;
  name: string;
  state: CampaignState;
  daily_budget: number | null;
  synced_at: string;
}
