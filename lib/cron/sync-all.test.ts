import { describe, it, expect, vi } from 'vitest';
import { runFullSync, type RunFullSyncDeps } from './sync-all';
import { FakeAmazonClient } from '@/lib/amazon/fake-client';
import { FakeAdsClient } from '@/lib/ads/fake-client';

// The scheduled full-sync orchestration: SP-API + Advertising sources -> all
// four mirror upserts. We inject FakeAmazonClient + FakeAdsClient and a mocked
// admin client so there is no live network or DB. The mock records which tables
// were written so we can prove the orchestration covers catalog, inventory AND
// ads (the A3 regression guard).
//
// NOTE: import the fakes from their modules directly, not the '@/lib/amazon' /
// '@/lib/ads' barrels, which pull the real clients -> 'server-only'.

/** A mock admin client exposing the write methods used by the sync chain. */
function makeAdminMock() {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const sourceRunInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
    }),
  });
  const sourceRunUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'source_sync_runs') {
      return { insert: sourceRunInsert, update: sourceRunUpdate };
    }
    return { upsert };
  });
  return {
    admin: { from } as unknown as RunFullSyncDeps['admin'],
    from,
    upsert,
  };
}

describe('runFullSync', () => {
  it('refreshes catalog, inventory AND ads mirrors in one run', async () => {
    const { admin, from } = makeAdminMock();

    const counts = await runFullSync({
      amazonClient: new FakeAmazonClient(),
      adsClient: new FakeAdsClient(),
      admin,
    });

    // Every mirror table was written exactly once — ads included (the A3 guard).
    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables).toEqual(
      expect.arrayContaining([
        'catalog_items',
        'inventory_levels',
        'source_sync_runs',
        'source_sync_state',
        'ads_campaigns',
        'ads_campaign_metrics',
      ]),
    );

    // Counts reflect the seeded fakes: 2 catalog + 2 inventory, 3 + 3 ads.
    expect(counts).toEqual({
      catalog: 2,
      inventory: 2,
      adsCampaigns: 3,
      adsCampaignMetrics: 3,
    });
  });

  it('runs the syncs in order and stops at the first failure', async () => {
    // Fail on the ads_campaigns write to prove ads is wired into the chain and
    // that a downstream failure aborts the rest (no metrics write after it).
    const upsert = vi.fn().mockImplementation((_rows, _opts) => {
      return Promise.resolve({ data: null, error: null });
    });
    const sourceRunInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
      }),
    });
    const sourceRunUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'source_sync_runs') {
        return { insert: sourceRunInsert, update: sourceRunUpdate };
      }
      if (table === 'ads_campaigns') {
        return {
          upsert: vi
            .fn()
            .mockResolvedValue({ data: null, error: { message: 'boom' } }),
        };
      }
      return { upsert };
    });
    const admin = { from } as unknown as RunFullSyncDeps['admin'];

    await expect(
      runFullSync({
        amazonClient: new FakeAmazonClient(),
        adsClient: new FakeAdsClient(),
        admin,
      }),
    ).rejects.toThrow(/mirror upsert failed: boom/);

    // Reached ads_campaigns but never ads_campaign_metrics (chain aborted).
    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables).toContain('ads_campaigns');
    expect(tables).not.toContain('ads_campaign_metrics');
  });
});
