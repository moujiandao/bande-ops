import { describe, expect, it } from 'vitest';
import type { SalesAnalyticsProduct } from './service';
import {
  buildAnalyticsViewModel,
  parseAnalyticsViewQuery,
} from './view';

function product(
  sku: string,
  trend: SalesAnalyticsProduct['momentum']['trend'],
  options: {
    change?: number | null;
    recent?: number | null;
    constrained?: boolean;
    legacy?: boolean;
    inStockTrend?: SalesAnalyticsProduct['trend']['trend'];
    slope?: number;
    stockoutConstrained?: boolean;
  } = {},
): SalesAnalyticsProduct {
  const recent = options.recent ?? null;
  return {
    marketplaceId: 'ATVPDKIKX0DER',
    sku,
    title: `${sku} product`,
    isLegacy: options.legacy ?? false,
    usableSupply: 10,
    fba: 10,
    fbaAvailable: 10,
    fbaFcTransfer: 0,
    fbaInbound: 0,
    awd: 0,
    svd: 0,
    configuredVelocity: 1,
    momentum: {
      days: [],
      recent:
        recent === null
          ? null
          : {
              startDate: '2026-09-10',
              endDate: '2026-09-16',
              eligibleDays: 7,
              calendarDays: 7,
              unitsShipped: recent * 7,
              totalShipments: recent * 7,
              excludedGiveawayUnits: 0,
              dailyVelocity: recent,
              possibleSelloutDays: 0,
              restockDays: 0,
              shipmentEvidenceOnlyDays: 0,
              excludedStockoutDays: 0,
            },
      previous: null,
      older: null,
      early: null,
      best: null,
      absoluteChange: options.change ?? null,
      percentageChange: null,
      trend,
      dataThroughDate: '2026-09-16',
    },
    trend: {
      days: [],
      runs: [],
      latestRun: options.slope === undefined ? null : {
        startDate: '2026-09-10', endDate: '2026-09-16', fullRunDays: 7,
        eligibleDays: 7, unitsShipped: 21, averageVelocity: 3,
        startVelocity: 2, endVelocity: 4, slopePerDay: options.slope,
        growthPercent: 100, direction: 'growing', endedInSellout: false,
      },
      best: null,
      trend: options.inStockTrend ?? 'insufficient-data',
      confidence: 'none',
      growingRuns: 0,
      qualifyingRuns: 0,
      stockoutConstrained: options.stockoutConstrained ?? false,
      dataThroughDate: '2026-09-16',
    },
    coverDays: { configured: 10, recent: 10, best: null },
    currentEvidenceAvailable: true,
    currentTrendEvidenceAvailable: true,
    stockConstrained: options.constrained ?? false,
  };
}

describe('parseAnalyticsViewQuery', () => {
  it('accepts supported controls and normalizes search input', () => {
    expect(
      parseAnalyticsViewQuery({
        window: '14',
        history: '180',
        filter: 'trending',
        sort: 'recent',
        q: '  widget ',
        sku: 'SKU-2',
      }),
    ).toEqual({
      windowDays: 14,
      historyDays: 180,
      filter: 'trending',
      sort: 'recent',
      query: 'widget',
      selectedSku: 'SKU-2',
    });
  });

  it('falls back safely for unsupported URL values', () => {
    expect(
      parseAnalyticsViewQuery({
        window: '13',
        history: '999',
        filter: 'invented',
        sort: 'invented',
      }),
    ).toMatchObject({
      windowDays: 7,
      historyDays: 365,
      filter: 'all',
      sort: 'change',
    });
  });
});

describe('buildAnalyticsViewModel', () => {
  const products = [
    product('SKU-B', 'trending-up', { change: 2, recent: 4, inStockTrend: 'growing', slope: 0.5 }),
    product('SKU-A', 'early-launch', { recent: 3, constrained: true }),
    product('SKU-C', 'no-observed-shipments', { recent: 0 }),
    product('OLD', 'historical-only', { legacy: true }),
  ];

  it('filters, searches, sorts, and selects independently', () => {
    const query = parseAnalyticsViewQuery({
      filter: 'trending',
      sort: 'change',
      q: 'sku',
      sku: 'SKU-A',
    });
    const view = buildAnalyticsViewModel(products, query);

    expect(view.visible.map((row) => row.sku)).toEqual(['SKU-B']);
    expect(view.selected?.sku).toBe('SKU-A');
    expect(view.summary).toEqual({
      trending: 1,
      early: 1,
      constrained: 1,
      insufficient: 1,
      growing: 1,
      declining: 0,
      quickSellout: 0,
    });
  });

  it('keeps legacy products out of the default view and exposes historical', () => {
    const all = buildAnalyticsViewModel(products, parseAnalyticsViewQuery({}));
    const historical = buildAnalyticsViewModel(
      products,
      parseAnalyticsViewQuery({ filter: 'historical' }),
    );

    expect(all.visible.map((row) => row.sku)).not.toContain('OLD');
    expect(historical.visible.map((row) => row.sku)).toEqual(['OLD']);
  });

  it('sorts unknown values after real values', () => {
    const view = buildAnalyticsViewModel(
      products,
      parseAnalyticsViewQuery({ sort: 'recent' }),
    );

    expect(view.visible.map((row) => row.sku)).toEqual([
      'SKU-B',
      'SKU-A',
      'SKU-C',
    ]);
  });

  it('filters and sorts the separate in-stock signal without changing momentum classification', () => {
    const growing = buildAnalyticsViewModel(products, parseAnalyticsViewQuery({ filter: 'growing' }));
    expect(growing.visible.map((row) => row.sku)).toEqual(['SKU-B']);
    const sorted = buildAnalyticsViewModel(products, parseAnalyticsViewQuery({ sort: 'trend' }));
    expect(sorted.visible[0].sku).toBe('SKU-B');
  });

  it('includes long runs ending in sellout in the stockout-constrained filter', () => {
    const constrained = product('SELL', 'stable', {
      inStockTrend: 'growing', slope: 0.4, stockoutConstrained: true,
    });
    const view = buildAnalyticsViewModel([...products, constrained], parseAnalyticsViewQuery({ filter: 'quick-sellout' }));
    expect(view.visible.map((row) => row.sku)).toEqual(['SELL']);
    expect(view.summary.quickSellout).toBe(1);
  });

  it('does not present historical sellouts as current stockout constraints', () => {
    const stale = product('STALE', 'historical-only', {
      inStockTrend: 'historical-only', stockoutConstrained: true,
    });
    const view = buildAnalyticsViewModel([stale], parseAnalyticsViewQuery({ filter: 'quick-sellout' }));
    expect(view.visible).toEqual([]);
    expect(view.summary.quickSellout).toBe(0);
    const historical = buildAnalyticsViewModel([stale], parseAnalyticsViewQuery({ filter: 'historical' }));
    expect(historical.visible.map((row) => row.sku)).toEqual(['STALE']);
  });
});
