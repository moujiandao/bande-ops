import { describe, it, expect, vi } from 'vitest';
import { syncCampaigns, type SyncCampaignsDeps } from './sync';
import { FakeAdsClient } from './fake-client';
import { DEFAULT_MARKETPLACE, type Campaign } from './types';

// Sync orchestration: Advertising API (source of truth) -> mirror upsert. We
// inject a FakeAdsClient and a mocked admin client so there is no live network
// or DB. The mock captures the upsert payload + options so we can assert exactly
// what would be written, and re-run the sync to prove idempotency.
//
// NOTE: import FakeAdsClient from './fake-client' directly, not the '@/lib/ads'
// barrel, which pulls AdsApiClient -> 'server-only'.

/** A mock admin client exposing just `from().upsert()`, recording calls. */
function makeAdminMock() {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn().mockReturnValue({ upsert });
  return {
    admin: { from } as unknown as SyncCampaignsDeps['admin'],
    from,
    upsert,
  };
}

describe('syncCampaigns', () => {
  it('upserts the FakeAdsClient campaigns into ads_campaigns', async () => {
    const { admin, from, upsert } = makeAdminMock();
    const client = new FakeAdsClient();

    const result = await syncCampaigns({ client, admin });

    // Wrote to the mirror table, keyed on the composite natural key.
    expect(from).toHaveBeenCalledWith('ads_campaigns');
    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, options] = upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: 'marketplace_id,campaign_id' });

    // Three seeded fake campaigns, each mapped to a mirror row tagged US.
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.marketplace_id).toBe(DEFAULT_MARKETPLACE.id);
      expect(typeof row.synced_at).toBe('string');
    }

    // The UNKNOWN-budget campaign carries null through to the row, never 0.
    const unknown = rows.find(
      (r: { campaign_id: string }) => r.campaign_id === '333333333',
    );
    expect(unknown.daily_budget).toBeNull();
    expect(unknown.daily_budget).not.toBe(0);

    expect(result.count).toBe(3);
    expect(result.marketplaceId).toBe(DEFAULT_MARKETPLACE.id);
  });

  it('stamps every row in a sync with one shared synced_at', async () => {
    const { admin, upsert } = makeAdminMock();
    await syncCampaigns({ client: new FakeAdsClient(), admin });

    const [rows] = upsert.mock.calls[0];
    const stamps = new Set(rows.map((r: { synced_at: string }) => r.synced_at));
    expect(stamps.size).toBe(1);
  });

  it('is idempotent: re-running upserts the same key set, not duplicates', async () => {
    const seed: Campaign[] = [
      { campaignId: 'SEED-1', name: 'One', state: 'enabled', dailyBudget: 10 },
      { campaignId: 'SEED-2', name: 'Two', state: 'paused', dailyBudget: null },
    ];
    const client = new FakeAdsClient({ campaigns: seed });
    const { admin, upsert } = makeAdminMock();

    await syncCampaigns({ client, admin });
    await syncCampaigns({ client, admin });

    expect(upsert).toHaveBeenCalledTimes(2);
    const firstKeys = upsert.mock.calls[0][0].map(
      (r: { marketplace_id: string; campaign_id: string }) =>
        `${r.marketplace_id}:${r.campaign_id}`,
    );
    const secondKeys = upsert.mock.calls[1][0].map(
      (r: { marketplace_id: string; campaign_id: string }) =>
        `${r.marketplace_id}:${r.campaign_id}`,
    );
    // Same composite keys both runs -> conflict target overwrites, no dupes.
    expect(secondKeys).toEqual(firstKeys);
    expect(new Set(secondKeys).size).toBe(secondKeys.length);
  });

  it('throws a clear error when the mirror upsert fails', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'boom' } });
    const from = vi.fn().mockReturnValue({ upsert });
    const admin = { from } as unknown as SyncCampaignsDeps['admin'];

    await expect(
      syncCampaigns({ client: new FakeAdsClient(), admin }),
    ).rejects.toThrow(/mirror upsert failed: boom/);
  });

  it('passes the marketplace through to the Ads client (US by default)', async () => {
    const { admin } = makeAdminMock();
    const listSpy = vi.fn().mockResolvedValue([]);
    const client = { listCampaigns: listSpy };

    const result = await syncCampaigns({ client, admin });

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(result.marketplaceId).toBe(DEFAULT_MARKETPLACE.id);
  });
});
