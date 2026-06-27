import { describe, it, expect } from 'vitest';
import { mapCampaignToRow, mapCampaignsToRows } from './mapping';
import { DEFAULT_MARKETPLACE, type Campaign } from './types';

// The pure mapping is the load-bearing seam between the Advertising API's shape
// and our mirror table. These tests pin the column names, the US marketplace
// default, the single-timestamp-per-batch behavior, and — most importantly —
// the UNKNOWN-budget invariant (null is preserved, never 0). All without a DB.

const FIXED = new Date('2026-06-26T12:00:00.000Z');

describe('mapCampaignToRow', () => {
  it('maps a Campaign to a snake_case ads_campaigns row', () => {
    const campaign: Campaign = {
      campaignId: '111111111',
      name: 'Bande SP — Brand Defense',
      state: 'enabled',
      dailyBudget: 25,
    };

    const row = mapCampaignToRow(campaign, { syncedAt: FIXED });

    expect(row).toEqual({
      marketplace_id: DEFAULT_MARKETPLACE.id,
      campaign_id: '111111111',
      name: 'Bande SP — Brand Defense',
      state: 'enabled',
      daily_budget: 25,
      synced_at: FIXED.toISOString(),
    });
  });

  it('defaults marketplace_id to US when none is provided', () => {
    const row = mapCampaignToRow(
      { campaignId: 'C', name: 'N', state: 'paused', dailyBudget: 1 },
      { syncedAt: FIXED },
    );
    expect(row.marketplace_id).toBe('ATVPDKIKX0DER');
    expect(row.marketplace_id).toBe(DEFAULT_MARKETPLACE.id);
  });

  it('preserves an UNKNOWN (null) daily budget as null — never 0', () => {
    const row = mapCampaignToRow(
      { campaignId: 'C', name: 'N', state: 'enabled', dailyBudget: null },
      { syncedAt: FIXED },
    );
    expect(row.daily_budget).toBeNull();
    expect(row.daily_budget).not.toBe(0);
  });

  it('keeps a true 0 budget distinct from UNKNOWN', () => {
    const row = mapCampaignToRow(
      { campaignId: 'C', name: 'N', state: 'paused', dailyBudget: 0 },
      { syncedAt: FIXED },
    );
    expect(row.daily_budget).toBe(0);
  });

  it('honors an explicit marketplace_id override', () => {
    const row = mapCampaignToRow(
      { campaignId: 'C', name: 'N', state: 'archived', dailyBudget: 5 },
      { marketplaceId: 'A1OTHER', syncedAt: FIXED },
    );
    expect(row.marketplace_id).toBe('A1OTHER');
  });
});

describe('mapCampaignsToRows', () => {
  it('stamps every row in a batch with the same synced_at', () => {
    const campaigns: Campaign[] = [
      { campaignId: 'C1', name: 'One', state: 'enabled', dailyBudget: 10 },
      { campaignId: 'C2', name: 'Two', state: 'paused', dailyBudget: null },
    ];

    const rows = mapCampaignsToRows(campaigns, { syncedAt: FIXED });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.synced_at)).size).toBe(1);
    expect(rows[0].synced_at).toBe(FIXED.toISOString());
    expect(rows[1].daily_budget).toBeNull();
  });

  it('returns an empty array for no campaigns', () => {
    expect(mapCampaignsToRows([], { syncedAt: FIXED })).toEqual([]);
  });
});
