import { describe, expect, it } from 'vitest';
import {
  amazonSideCover,
  shouldReplenishFromSvd,
  suggestedShipQty,
} from './replenish';
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
  // `amazonSideCounted` is the ONLY quantity these pure functions read for the
  // math; it is assembled (and policy-gated) in service.ts. Tests set it
  // directly rather than reconstructing it from fba/awd here — reconstructing it
  // was the very double-count bug this figure exists to prevent. fba/awd remain
  // only because `amazonSideCover` reads them for its "both unknown" null guard.
  const sources = {
    fba: 10,
    awd: 0,
    svd: 0,
    fbaInbound: 0,
    amazonSideCounted: 10,
    ...sourceOverrides,
  };
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
    boxName: null,
    fnSku: null,
    supplyBreakdown: null,
    recommendation: { status: 'needs-review', reason: 'unknown-demand' },
    ...rest,
    sources,
  };
}

describe('amazonSideCover', () => {
  it('derives days of cover from the counted amazon-side total', () => {
    // 40 counted units at 4/day = 10 days.
    const result = amazonSideCover(
      row({ sources: { amazonSideCounted: 40 }, dailyDemand: 4 }),
    );
    expect(result).toBe(10);
  });

  it('ignores SVD, which cannot fulfil orders', () => {
    // SVD is not part of the counted total and must not extend Amazon-side cover.
    const result = amazonSideCover(
      row({ sources: { amazonSideCounted: 40, svd: 9999 }, dailyDemand: 4 }),
    );
    expect(result).toBe(10);
  });

  it('returns null without usable demand', () => {
    expect(amazonSideCover(row({ dailyDemand: null }))).toBeNull();
    expect(amazonSideCover(row({ dailyDemand: 0 }))).toBeNull();
  });

  it('returns null when both FBA and AWD are unknown', () => {
    expect(
      amazonSideCover(
        row({ sources: { fba: null, awd: null, svd: 100, amazonSideCounted: 0 } }),
      ),
    ).toBeNull();
  });
});

describe('suggestedShipQty', () => {
  it('ships the shortfall to the coverage target', () => {
    // Target 30 days at 4/day = 120 units; 20 counted on the Amazon side leaves 100.
    const result = suggestedShipQty(
      row({ sources: { amazonSideCounted: 20, svd: 500 }, dailyDemand: 4 }),
      30,
    );
    expect(result).toBe(100);
  });

  it('ships less when the counted total is higher (e.g. FBA incoming credited)', () => {
    // 70 counted (say 20 fulfillable + 50 inbound): shortfall 120 − 70 = 50.
    const result = suggestedShipQty(
      row({ sources: { amazonSideCounted: 70, svd: 500 }, dailyDemand: 4 }),
      30,
    );
    expect(result).toBe(50);
  });

  it('never suggests shipping more than SVD holds', () => {
    const result = suggestedShipQty(
      row({ sources: { amazonSideCounted: 20, svd: 60 }, dailyDemand: 4 }),
      30,
    );
    expect(result).toBe(60);
  });

  it('returns null when the counted total already meets the target', () => {
    const result = suggestedShipQty(
      row({ sources: { amazonSideCounted: 500, svd: 500 }, dailyDemand: 4 }),
      30,
    );
    expect(result).toBeNull();
  });

  it('returns null when SVD has nothing to send', () => {
    expect(
      suggestedShipQty(row({ sources: { amazonSideCounted: 0, svd: 0 } }), 30),
    ).toBeNull();
  });

  it('returns null when the SVD figure is unknown', () => {
    // Null here means the units could not be derived — an unset pack size, for
    // instance. Shipping off an unknown is exactly what must not happen.
    expect(
      suggestedShipQty(row({ sources: { amazonSideCounted: 0, svd: null } }), 30),
    ).toBeNull();
  });
});

describe('shouldReplenishFromSvd', () => {
  it('uses the configured target for both eligibility and ship quantity', () => {
    // 180 counted units at 4/day gives 45 days of Amazon-side cover.
    const candidate = row({
      sources: { amazonSideCounted: 180, svd: 500 },
      dailyDemand: 4,
    });

    expect(shouldReplenishFromSvd(candidate, 30)).toBe(false);
    expect(shouldReplenishFromSvd(candidate, 60)).toBe(true);
    expect(suggestedShipQty(candidate, 60)).toBe(60);
  });
});
