import type { AdsClient } from './client';
import type { Campaign } from './types';

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

  constructor(seed?: { campaigns?: Campaign[] }) {
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
}
