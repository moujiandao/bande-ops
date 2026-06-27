import {
  DEFAULT_MARKETPLACE,
  type AdsCampaignMetricsRow,
  type CampaignMetrics,
} from './types';

/**
 * Pure `CampaignMetrics -> ads_campaign_metrics row` mapping.
 *
 * No DB, no network. Pass a fixed `syncedAt` in tests for determinism. We set
 * `synced_at` explicitly (rather than leaning on the DB default) so an UPSERT
 * refreshes it on conflict; a column default only fires on INSERT.
 *
 * The UNKNOWN invariant lives here: every null metric is preserved as null,
 * NEVER coerced to 0. ACOS/ROAS are NOT mapped — they are computed at render
 * time from cost/sales (see `metrics.ts`), so the mirror stores only raw inputs.
 *
 * NOTE: import constants/types from './types' (not the '@/lib/ads' barrel) — the
 * barrel pulls AdsApiClient -> 'server-only', which would make this pure module
 * unimportable from a unit test.
 */

export interface MapMetricsOptions {
  /** Marketplace this row belongs to. Overrides the metrics' own field. */
  marketplaceId?: string;
  /** Sync timestamp stamped onto the row. Defaults to now. */
  syncedAt?: Date;
}

export function mapMetricsToRow(
  metrics: CampaignMetrics,
  opts: MapMetricsOptions = {},
): AdsCampaignMetricsRow {
  // Prefer an explicit override, then the metrics' own marketplace, then US.
  const marketplaceId =
    opts.marketplaceId ?? (metrics.marketplaceId || DEFAULT_MARKETPLACE.id);
  const syncedAt = opts.syncedAt ?? new Date();

  return {
    marketplace_id: marketplaceId,
    campaign_id: metrics.campaignId,
    // Preserve UNKNOWN: a null metric stays null, never 0.
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    cost: metrics.cost,
    sales: metrics.sales,
    synced_at: syncedAt.toISOString(),
  };
}

/** Map a batch of metrics, stamping every row with the same timestamp. */
export function mapMetricsToRows(
  metricsList: CampaignMetrics[],
  opts: MapMetricsOptions = {},
): AdsCampaignMetricsRow[] {
  // Resolve `syncedAt` once so every row in a single sync shares one timestamp.
  const syncedAt = opts.syncedAt ?? new Date();
  return metricsList.map((metrics) =>
    mapMetricsToRow(metrics, { ...opts, syncedAt }),
  );
}
