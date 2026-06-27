import type { AdsClient, GetCampaignMetricsOptions } from './client';
import { DEFAULT_MARKETPLACE, type Campaign, type CampaignMetrics } from './types';

/**
 * Deterministic, network-free AdsClient for tests and local dev.
 *
 * Returns small canned data covering the states modules care about: one enabled
 * campaign with a real daily budget, one paused, and one with a null/UNKNOWN
 * budget to exercise the UNKNOWN-budget path (must never be treated as 0).
 *
 * NOTE: imports ONLY the `AdsClient` type (erased at compile) and the `Campaign`
 * type from sibling modules, so this file stays node-safe — it never pulls in
 * the 'server-only' client implementation.
 */
export class FakeAdsClient implements AdsClient {
  private readonly campaigns: Campaign[];
  private readonly metrics: CampaignMetrics[];

  constructor(seed?: { campaigns?: Campaign[]; metrics?: CampaignMetrics[] }) {
    this.metrics = seed?.metrics ?? [
      {
        // Full metrics: cost 40 / sales 200 -> ACOS 0.2 (20%), ROAS 5x.
        campaignId: '111111111',
        marketplaceId: DEFAULT_MARKETPLACE.id,
        impressions: 12000,
        clicks: 340,
        cost: 40,
        sales: 200,
      },
      {
        // Spend, no sales: cost 15 / sales 0 -> ACOS UNKNOWN (null, never 0),
        // ROAS 0. Exercises the divide-by-zero -> UNKNOWN path on the page.
        campaignId: '222222222',
        marketplaceId: DEFAULT_MARKETPLACE.id,
        impressions: 800,
        clicks: 12,
        cost: 15,
        sales: 0,
      },
      {
        // All UNKNOWN: Amazon reported nothing. Every metric null, never 0;
        // both ACOS and ROAS resolve to UNKNOWN.
        campaignId: '333333333',
        marketplaceId: DEFAULT_MARKETPLACE.id,
        impressions: null,
        clicks: null,
        cost: null,
        sales: null,
      },
    ];
    this.campaigns = seed?.campaigns ?? [
      {
        campaignId: '111111111',
        name: 'Bande SP — Brand Defense',
        state: 'enabled',
        dailyBudget: 25,
      },
      {
        campaignId: '222222222',
        name: 'Bande SP — Auto Discovery',
        state: 'paused',
        dailyBudget: 10,
      },
      {
        // UNKNOWN budget: Amazon reported non-numeric/unavailable.
        campaignId: '333333333',
        name: 'Bande SP — Legacy Import',
        state: 'enabled',
        dailyBudget: null,
      },
    ];
  }

  async listCampaigns(): Promise<Campaign[]> {
    return this.campaigns;
  }

  // The fake returns canned metrics directly (no async report machinery). The
  // window is ignored — determinism matters more than honoring the date range.
  async getCampaignMetrics(
    _opts?: GetCampaignMetricsOptions,
  ): Promise<CampaignMetrics[]> {
    return this.metrics;
  }
}
