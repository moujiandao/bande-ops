import { describe, expect, it } from 'vitest';
import type { InStockTrendKind } from './in-stock-trend';
import type { SalesAnalyticsProduct } from './service';
import {
  buildAnalyticsViewModel,
  parseAnalyticsViewQuery,
} from './view';

function product(
  sku: string,
  kind: InStockTrendKind,
  options: {
    slope?: number | null;
    latest?: number | null;
    constrained?: boolean;
    legacy?: boolean;
  } = {},
): SalesAnalyticsProduct {
  const latest = options.latest ?? null;
  const slope = options.slope ?? null;
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
    trend: {
      days: [],
      runs: [],
      latestRun:
        latest === null
          ? null
          : {
              startDate: '2026-09-10',
              endDate: '2026-09-16',
              fullRunDays: 7,
              eligibleDays: 7,
              unitsShipped: latest * 7,
              averageVelocity: latest,
              startVelocity: latest - (slope ?? 0) * 3,
              endVelocity: latest + (slope ?? 0) * 3,
              slopePerDay: slope,
              growthPercent: null,
              direction:
                kind === 'growing'
                  ? 'growing'
                  : kind === 'declining'
                    ? 'declining'
                    : 'stable',
              endedInSellout: kind === 'quick-sellout',
            },
      best: null,
      trend: kind,
      confidence: latest === null ? 'none' : 'medium',
      growingRuns: kind === 'growing' ? 1 : 0,
      qualifyingRuns: latest === null ? 0 : 1,
      stockoutConstrained: kind === 'quick-sellout',
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
        filter: 'growing',
        sort: 'latest',
        q: '  widget ',
        sku: 'SKU-2',
      }),
    ).toEqual({
      windowDays: 14,
      historyDays: 180,
      filter: 'growing',
      sort: 'latest',
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
      sort: 'slope',
    });
  });
});

describe('buildAnalyticsViewModel', () => {
  const products = [
    product('SKU-B', 'growing', { slope: 0.5, latest: 4 }),
    product('SKU-A', 'quick-sellout', { latest: 3, constrained: true }),
    product('SKU-C', 'insufficient-data'),
    product('SKU-D', 'declining', { slope: -0.4, latest: 2 }),
    product('OLD', 'historical-only', { legacy: true }),
  ];

  it('filters, searches, sorts, and selects independently', () => {
    const query = parseAnalyticsViewQuery({
      filter: 'growing',
      sort: 'slope',
      q: 'sku',
      sku: 'SKU-A',
    });
    const view = buildAnalyticsViewModel(products, query);

    expect(view.visible.map((row) => row.sku)).toEqual(['SKU-B']);
    expect(view.selected?.sku).toBe('SKU-A');
    expect(view.summary).toEqual({
      growing: 1,
      constrained: 1,
      declining: 1,
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
      parseAnalyticsViewQuery({ sort: 'latest' }),
    );

    expect(view.visible.map((row) => row.sku)).toEqual([
      'SKU-B',
      'SKU-A',
      'SKU-D',
      'SKU-C',
    ]);
  });
});
