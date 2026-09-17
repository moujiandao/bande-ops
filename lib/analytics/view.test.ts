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
    coverDays: { configured: 10, recent: 10, best: null },
    currentEvidenceAvailable: true,
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
    product('SKU-B', 'trending-up', { change: 2, recent: 4 }),
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
});
