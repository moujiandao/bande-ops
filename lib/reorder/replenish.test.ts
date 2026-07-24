import { describe, expect, it } from 'vitest';
import { amazonSideCover, suggestedShipQty } from './replenish';
import type { RecommendationRow } from './service';

/**
 * These functions consume only a handful of fields, but the row type is wide.
 * The factory keeps each test to the fields it actually varies.
 */
type RowOverrides = Omit<Partial<RecommendationRow>, 'sources'> & {
  sources?: Partial<RecommendationRow['sources']>;
};

function row(overrides: RowOverrides = {}): RecommendationRow {
  const { sources: sourceOverrides, ...rest } = overrides;
  const sources = {
    fba: 10,
    awd: 0,
    svd: 0,
    fbaInbound: 0,
    amazonSideCounted: 0,
    ...sourceOverrides,
  };
  // The counted amazon-side figure is derived in service.ts. Here it stands in
  // as the sum of the fulfillable + counted inbound + AWD the test supplies,
  // unless the case sets it explicitly. (The AWD-replenishment double-count that
  // this figure exists to prevent is exercised at the service layer, not here.)
  const amazonSideCounted = sourceOverrides?.amazonSideCounted ??
    (sources.fba ?? 0) + (sources.fbaInbound ?? 0) + (sources.awd ?? 0);
  return {
    marketplaceId: 'ATVPDKIKX0DER',
    sku: 'SKU',
    title: 'Title',
    usableSupply: null,
    dailyDemand: 4,
    velocitySampleDays: 90,
    sourceMapping: { status: 'mapped', svdItemId: 'svd-1', mappingSource: 'sku' },
    isLegacy: false,
    fbaBreakdown: {
      available: 10,
      reserved: 0,
      inboundWorking: 0,
      inboundShipped: 0,
      inboundReceiving: 0,
      researching: 0,
      unfulfillable: 0,
    },
    svdBoxes: 0,
    svdUnitsPerBox: null,
    fnSku: null,
    supplyBreakdown: null,
    recommendation: { status: 'needs-review', reason: 'unknown-demand' },
    ...rest,
    sources: { ...sources, amazonSideCounted },
  };
}

describe('amazonSideCover', () => {
  it('counts only FBA and AWD, not SVD', () => {
    // SVD stock cannot fulfil an order, so it must not extend Amazon-side cover.
    const result = amazonSideCover(
      row({ sources: { fba: 10, awd: 30, svd: 9999, fbaInbound: 0 }, dailyDemand: 4 }),
    );
    expect(result).toBe(10);
  });

  it('counts FBA incoming (fbaInbound) toward cover', () => {
    // 10 fulfillable + 30 incoming + 0 AWD = 40 units; at 4/day that is 10 days.
    const result = amazonSideCover(
      row({ sources: { fba: 10, awd: 0, svd: 0, fbaInbound: 30 }, dailyDemand: 4 }),
    );
    expect(result).toBe(10);
  });

  it('returns null without usable demand', () => {
    expect(amazonSideCover(row({ dailyDemand: null }))).toBeNull();
    expect(amazonSideCover(row({ dailyDemand: 0 }))).toBeNull();
  });

  it('returns null when both Amazon-side sources are unknown', () => {
    expect(
      amazonSideCover(
        row({ sources: { fba: null, awd: null, svd: 100, fbaInbound: null } }),
      ),
    ).toBeNull();
  });
});

describe('suggestedShipQty', () => {
  it('ships the shortfall to the coverage target', () => {
    // Target 30 days at 4/day = 120 units; 20 on the Amazon side leaves 100.
    const result = suggestedShipQty(
      row({ sources: { fba: 20, awd: 0, svd: 500, fbaInbound: 0 }, dailyDemand: 4 }),
      30,
    );
    expect(result).toBe(100);
  });

  it('credits FBA incoming so less is shipped from SVD', () => {
    // Same as above but 50 units already inbound: shortfall 120 − 70 = 50.
    const result = suggestedShipQty(
      row({ sources: { fba: 20, awd: 0, svd: 500, fbaInbound: 50 }, dailyDemand: 4 }),
      30,
    );
    expect(result).toBe(50);
  });

  it('never suggests shipping more than SVD holds', () => {
    const result = suggestedShipQty(
      row({ sources: { fba: 20, awd: 0, svd: 60, fbaInbound: 0 }, dailyDemand: 4 }),
      30,
    );
    expect(result).toBe(60);
  });

  it('returns null when incoming alone already meets the target', () => {
    // Fulfillable 20 + incoming 500 covers 30 days at 4/day; nothing to ship.
    const result = suggestedShipQty(
      row({ sources: { fba: 20, awd: 0, svd: 500, fbaInbound: 500 }, dailyDemand: 4 }),
      30,
    );
    expect(result).toBeNull();
  });

  it('returns null when the Amazon side already meets the target', () => {
    const result = suggestedShipQty(
      row({ sources: { fba: 500, awd: 0, svd: 500, fbaInbound: 0 }, dailyDemand: 4 }),
      30,
    );
    expect(result).toBeNull();
  });

  it('returns null when SVD has nothing to send', () => {
    expect(
      suggestedShipQty(
        row({ sources: { fba: 0, awd: 0, svd: 0, fbaInbound: 0 } }),
        30,
      ),
    ).toBeNull();
  });

  it('returns null when the SVD figure is unknown', () => {
    // Null here means the units could not be derived — an unset pack size, for
    // instance. Shipping off an unknown is exactly what must not happen.
    expect(
      suggestedShipQty(
        row({ sources: { fba: 0, awd: 0, svd: null, fbaInbound: 0 } }),
        30,
      ),
    ).toBeNull();
  });
});
