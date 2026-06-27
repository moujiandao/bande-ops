import { describe, it, expect } from 'vitest';
import {
  mapMetricsToRow,
  mapMetricsToRows,
} from './metrics-mapping';
import { DEFAULT_MARKETPLACE, type CampaignMetrics } from './types';

// The pure CampaignMetrics -> ads_campaign_metrics row mapping. Pins column
// names, the single-timestamp-per-batch behavior, and — most importantly — the
// UNKNOWN invariant: every null metric is preserved as null, NEVER coerced to 0.
// No DB.

const FIXED = new Date('2026-06-27T12:00:00.000Z');

describe('mapMetricsToRow', () => {
  it('maps full metrics to a snake_case row', () => {
    const metrics: CampaignMetrics = {
      campaignId: '111111111',
      marketplaceId: DEFAULT_MARKETPLACE.id,
      impressions: 1000,
      clicks: 50,
      cost: 40,
      sales: 200,
    };

    const row = mapMetricsToRow(metrics, { syncedAt: FIXED });

    expect(row).toEqual({
      marketplace_id: DEFAULT_MARKETPLACE.id,
      campaign_id: '111111111',
      impressions: 1000,
      clicks: 50,
      cost: 40,
      sales: 200,
      synced_at: FIXED.toISOString(),
    });
  });

  it('preserves UNKNOWN (null) metrics as null — never 0', () => {
    const metrics: CampaignMetrics = {
      campaignId: 'C',
      marketplaceId: DEFAULT_MARKETPLACE.id,
      impressions: null,
      clicks: null,
      cost: null,
      sales: null,
    };

    const row = mapMetricsToRow(metrics, { syncedAt: FIXED });

    expect(row.impressions).toBeNull();
    expect(row.clicks).toBeNull();
    expect(row.cost).toBeNull();
    expect(row.sales).toBeNull();
    expect(row.cost).not.toBe(0);
    expect(row.sales).not.toBe(0);
  });

  it('keeps a true 0 metric distinct from UNKNOWN', () => {
    const metrics: CampaignMetrics = {
      campaignId: 'C',
      marketplaceId: DEFAULT_MARKETPLACE.id,
      impressions: 0,
      clicks: 0,
      cost: 15,
      sales: 0, // spend, no sales
    };

    const row = mapMetricsToRow(metrics, { syncedAt: FIXED });

    expect(row.sales).toBe(0);
    expect(row.cost).toBe(15);
  });

  it('defaults marketplace_id to US when the metrics carry no marketplace', () => {
    const row = mapMetricsToRow(
      {
        campaignId: 'C',
        marketplaceId: '',
        impressions: null,
        clicks: null,
        cost: null,
        sales: null,
      },
      { syncedAt: FIXED },
    );
    expect(row.marketplace_id).toBe(DEFAULT_MARKETPLACE.id);
  });

  it('honors an explicit marketplaceId override', () => {
    const row = mapMetricsToRow(
      {
        campaignId: 'C',
        marketplaceId: DEFAULT_MARKETPLACE.id,
        impressions: 1,
        clicks: 1,
        cost: 1,
        sales: 1,
      },
      { marketplaceId: 'A1OTHER', syncedAt: FIXED },
    );
    expect(row.marketplace_id).toBe('A1OTHER');
  });
});

describe('mapMetricsToRows', () => {
  it('stamps every row in a batch with the same synced_at', () => {
    const metrics: CampaignMetrics[] = [
      {
        campaignId: 'C1',
        marketplaceId: DEFAULT_MARKETPLACE.id,
        impressions: 10,
        clicks: 1,
        cost: 2,
        sales: 8,
      },
      {
        campaignId: 'C2',
        marketplaceId: DEFAULT_MARKETPLACE.id,
        impressions: null,
        clicks: null,
        cost: null,
        sales: null,
      },
    ];

    const rows = mapMetricsToRows(metrics, { syncedAt: FIXED });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.synced_at)).size).toBe(1);
    expect(rows[1].cost).toBeNull();
  });

  it('returns an empty array for no metrics', () => {
    expect(mapMetricsToRows([], { syncedAt: FIXED })).toEqual([]);
  });
});
