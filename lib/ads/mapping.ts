import { DEFAULT_MARKETPLACE, type AdsCampaignRow, type Campaign } from './types';

/**
 * Pure `Campaign -> ads_campaigns row` mapping.
 *
 * No DB, no network, no hidden clock unless you let it default `syncedAt` —
 * pass a fixed `syncedAt` in tests for determinism. We set `synced_at`
 * explicitly (rather than leaning on the DB default) so an UPSERT refreshes it
 * on conflict; a column default only fires on INSERT.
 *
 * The UNKNOWN-budget invariant lives here: a null `dailyBudget` is preserved as
 * `daily_budget: null`, NEVER coerced to 0.
 *
 * NOTE: import the marketplace constant and types from './types' (not the
 * '@/lib/ads' barrel) — the barrel pulls AdsApiClient -> 'server-only', which
 * would make this pure module unimportable from a unit test.
 */

export interface MapCampaignOptions {
  /** Marketplace this row belongs to. Defaults to US. */
  marketplaceId?: string;
  /** Sync timestamp stamped onto the row. Defaults to now. */
  syncedAt?: Date;
}

export function mapCampaignToRow(
  campaign: Campaign,
  opts: MapCampaignOptions = {},
): AdsCampaignRow {
  const marketplaceId = opts.marketplaceId ?? DEFAULT_MARKETPLACE.id;
  const syncedAt = opts.syncedAt ?? new Date();

  return {
    marketplace_id: marketplaceId,
    campaign_id: campaign.campaignId,
    name: campaign.name,
    state: campaign.state,
    // Preserve UNKNOWN: null budget stays null, never 0.
    daily_budget: campaign.dailyBudget,
    synced_at: syncedAt.toISOString(),
  };
}

/** Map a batch of campaigns, stamping every row with the same timestamp. */
export function mapCampaignsToRows(
  campaigns: Campaign[],
  opts: MapCampaignOptions = {},
): AdsCampaignRow[] {
  // Resolve `syncedAt` once so every row in a single sync shares one timestamp.
  const syncedAt = opts.syncedAt ?? new Date();
  return campaigns.map((campaign) =>
    mapCampaignToRow(campaign, { ...opts, syncedAt }),
  );
}
