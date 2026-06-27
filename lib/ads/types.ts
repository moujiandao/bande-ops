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

/**
 * Performance metrics for a single campaign over a reporting window (Ads slice
 * A2). Pulled from the Advertising API v3 async reporting flow (spCampaigns).
 *
 * UNKNOWN convention (mirrors UNKNOWN-budget / UNKNOWN-stock): every metric is
 * `number | null` where `null` means "Amazon did not report a value" (UNKNOWN),
 * NEVER 0. A true 0 (e.g. zero clicks) is distinct from UNKNOWN and folded into
 * math; a null is not.
 *
 * Note: ACOS and ROAS are NOT stored here — they are COMPUTED on demand from
 * cost/sales via `lib/ads/metrics.ts`, so the divide-by-zero -> UNKNOWN rule
 * lives in exactly one tested place.
 */
export interface CampaignMetrics {
  campaignId: string;
  marketplaceId: string;
  /** null = UNKNOWN (Amazon reported no value); never 0. */
  impressions: number | null;
  /** null = UNKNOWN; never 0. */
  clicks: number | null;
  /** Ad spend. null = UNKNOWN; never 0. */
  cost: number | null;
  /** Attribution-windowed sales. null = UNKNOWN; never 0. */
  sales: number | null;
}

/**
 * A row of the `public.ads_campaign_metrics` synced mirror, exactly as written
 * to Postgres. snake_case columns; every metric is nullable (NULL = UNKNOWN,
 * never 0); `synced_at` is an ISO-8601 string. ACOS/ROAS are intentionally
 * absent (computed at render time), so the mirror only stores raw inputs.
 */
export interface AdsCampaignMetricsRow {
  marketplace_id: string;
  campaign_id: string;
  impressions: number | null;
  clicks: number | null;
  cost: number | null;
  sales: number | null;
  synced_at: string;
}
