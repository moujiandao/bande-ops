import { describe, it, expect } from 'vitest';
import { FakeAdsClient } from './fake-client';

// The AdsClient interface is the Ads module's single test seam. These tests pin
// the behavior modules rely on when they inject FakeAdsClient — especially the
// UNKNOWN-budget convention (null, never 0).
//
// NOTE: import FakeAdsClient from './fake-client' directly (not the barrel
// '@/lib/ads'), because the barrel pulls AdsApiClient -> 'server-only', which
// throws outside a server context.

describe('FakeAdsClient (test seam)', () => {
  it('lists campaigns with id/name/state', async () => {
    const campaigns = await new FakeAdsClient().listCampaigns();

    expect(campaigns.length).toBeGreaterThan(0);
    for (const c of campaigns) {
      expect(c.campaignId).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(['enabled', 'paused', 'archived']).toContain(c.state);
    }
  });

  it('includes an enabled, a paused, and an UNKNOWN-budget campaign', async () => {
    const campaigns = await new FakeAdsClient().listCampaigns();

    expect(campaigns.some((c) => c.state === 'enabled')).toBe(true);
    expect(campaigns.some((c) => c.state === 'paused')).toBe(true);

    const unknown = campaigns.find((c) => c.dailyBudget === null);
    expect(unknown, 'fake must include a null/UNKNOWN budget row').toBeDefined();
    // The whole point of the convention: null is distinct from a true zero.
    expect(unknown!.dailyBudget).toBeNull();
    expect(unknown!.dailyBudget).not.toBe(0);

    const funded = campaigns.find((c) => typeof c.dailyBudget === 'number');
    expect(funded, 'fake must include a numeric budget row').toBeDefined();
    expect(funded!.dailyBudget).toBeGreaterThanOrEqual(0);
  });

  it('accepts a seed so tests can stage their own scenarios', async () => {
    const client = new FakeAdsClient({
      campaigns: [
        { campaignId: 'SEED-1', name: 'Seed', state: 'paused', dailyBudget: null },
      ],
    });
    const [only] = await client.listCampaigns();
    expect(only.campaignId).toBe('SEED-1');
    expect(only.dailyBudget).toBeNull();
  });
});
