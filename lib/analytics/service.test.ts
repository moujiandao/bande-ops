import { describe, expect, it, vi } from 'vitest';
import type { RecommendationRow } from '@/lib/reorder/service';
import {
  analyticsSourceIssue,
  buildSalesAnalytics,
  readAnalyticsHistory,
  type ReadAnalyticsHistoryDeps,
} from './service';

describe('analyticsSourceIssue', () => {
  const now = new Date('2026-09-17T12:00:00.000Z');

  it('accepts a recent successful FBA ledger sync', () => {
    expect(
      analyticsSourceIssue(
        [
          {
            source: 'fba_ledger',
            status: 'success',
            lastSuccessAt: '2026-09-17T08:00:00.000Z',
            rowCount: 100,
            errorSummary: null,
          },
        ],
        now,
      ),
    ).toBeNull();
  });

  it('blocks failed, stale, and missing ledger state', () => {
    expect(analyticsSourceIssue([], now)).toMatch(/missing/i);
    expect(
      analyticsSourceIssue(
        [
          {
            source: 'fba_ledger',
            status: 'failed',
            lastSuccessAt: '2026-09-17T08:00:00.000Z',
            rowCount: 100,
            errorSummary: 'failed',
          },
        ],
        now,
      ),
    ).toMatch(/failed/i);
    expect(
      analyticsSourceIssue(
        [
          {
            source: 'fba_ledger',
            status: 'success',
            lastSuccessAt: '2026-09-14T08:00:00.000Z',
            rowCount: 100,
            errorSummary: null,
          },
        ],
        now,
      ),
    ).toMatch(/48 hours/i);
  });
});

function recommendation(): RecommendationRow {
  return {
    marketplaceId: 'ATVPDKIKX0DER',
    sku: 'SKU-1',
    title: 'Product',
    usableSupply: 70,
    dailyDemand: 2,
    velocitySampleDays: 90,
    sourceMapping: {
      status: 'mapped',
      svdItemId: 'SKU-1',
      mappingSource: 'sku',
    },
    isLegacy: false,
    sources: {
      fba: 20,
      awd: 30,
      svd: 10,
      fbaInbound: 10,
      amazonSideCounted: 60,
    },
    fbaBreakdown: {
      available: 20,
      reserved: 0,
      inboundWorking: 0,
      inboundShipped: 10,
      inboundReceiving: 0,
      researching: 0,
      unfulfillable: 0,
    },
    svdBoxes: 1,
    svdUnitsPerBox: 10,
    boxName: null,
    fnSku: 'FNSKU-1',
    supplyBreakdown: null,
    recommendation: { status: 'needs-review', reason: 'fixture' },
  };
}

describe('readAnalyticsHistory', () => {
  it('paginates beyond the Supabase default result limit', async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      marketplace_id: 'ATVPDKIKX0DER',
      sku: `SKU-${index}`,
      activity_date: '2026-09-15',
      customer_shipments: 1,
      customer_shipments_valid: true,
      sellable_starting_balance: 2,
      starting_balance_valid: true,
      sellable_ending_balance: 1,
      ending_balance_valid: true,
    }));
    const range = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [{ ...firstPage[0], sku: 'SKU-LAST', activity_date: '2026-09-16' }],
        error: null,
      });
    const orderSku = vi.fn().mockReturnValue({ range });
    const orderDate = vi.fn().mockReturnValue({ order: orderSku });
    const lte = vi.fn().mockReturnValue({ order: orderDate });
    const gte = vi.fn().mockReturnValue({ lte });
    const eq = vi.fn().mockReturnValue({ gte });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = {
      from: vi.fn().mockReturnValue({ select }),
    } as unknown as ReadAnalyticsHistoryDeps['supabase'];

    const result = await readAnalyticsHistory({
      supabase,
      historyDays: 365,
      now: new Date('2026-09-17T12:00:00.000Z'),
    });

    expect(result.rows).toHaveLength(1_001);
    expect(result.dataThroughDate).toBe('2026-09-16');
    expect(gte).toHaveBeenCalledWith('activity_date', '2025-09-17');
    expect(lte).toHaveBeenCalledWith('activity_date', '2026-09-16');
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1_000, 1_999);
  });
});

describe('buildSalesAnalytics', () => {
  it('combines canonical usable supply with observed and best velocity scenarios', () => {
    const dates = Array.from({ length: 14 }, (_, index) =>
      new Date(Date.parse('2026-09-04T00:00:00.000Z') + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
    const ledgerRows = dates.map((activity_date, index) => ({
      marketplace_id: 'ATVPDKIKX0DER',
      sku: 'SKU-1',
      activity_date,
      customer_shipments: index < 7 ? 2 : 5,
      customer_shipments_valid: true,
      sellable_starting_balance: 100,
      starting_balance_valid: true,
      sellable_ending_balance: 95,
      ending_balance_valid: true,
    }));

    const [result] = buildSalesAnalytics({
      products: [recommendation()],
      ledgerRows,
      windowDays: 7,
      historyDays: 90,
      dataThroughDate: '2026-09-17',
    });

    expect(result.momentum.trend).toBe('trending-up');
    expect(result.coverDays).toEqual({
      configured: 35,
      recent: 14,
      best: 14,
    });
    expect(result.stockConstrained).toBe(true);
  });

  it('preserves dated history while suppressing a current trend claim', () => {
    const ledgerRows = Array.from({ length: 14 }, (_, index) => ({
      marketplace_id: 'ATVPDKIKX0DER',
      sku: 'SKU-1',
      activity_date: new Date(
        Date.parse('2026-09-03T00:00:00.000Z') + index * 86_400_000,
      )
        .toISOString()
        .slice(0, 10),
      customer_shipments: index < 7 ? 2 : 5,
      customer_shipments_valid: true,
      sellable_starting_balance: 100,
      starting_balance_valid: true,
      sellable_ending_balance: 95,
      ending_balance_valid: true,
    }));

    const [result] = buildSalesAnalytics({
      products: [recommendation()],
      ledgerRows,
      windowDays: 7,
      historyDays: 90,
      dataThroughDate: '2026-09-16',
      currentEvidenceAvailable: false,
    });

    expect(result.momentum.trend).toBe('historical-only');
    expect(result.momentum.recent?.dailyVelocity).toBe(5);
    expect(result.momentum.previous?.dailyVelocity).toBe(2);
    expect(result.momentum.best).toMatchObject({
      startDate: '2026-09-10',
      endDate: '2026-09-16',
      dailyVelocity: 5,
    });
    expect(result.momentum.days).toHaveLength(14);
    expect(result.currentEvidenceAvailable).toBe(false);
    expect(result.stockConstrained).toBe(false);
  });
});
