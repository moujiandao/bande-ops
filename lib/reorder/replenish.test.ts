import { describe, expect, it } from 'vitest';
import {
  applySvdShipmentBoxCount,
  amazonSideCover,
  buildSvdShipmentEmail,
  formatShipmentMonthYear,
  initialSvdShipmentBoxCounts,
  shouldReplenishFromSvd,
  suggestedBoxesToSend,
  suggestedShipQty,
  svdShipmentDraftKey,
  svdShipmentRowKey,
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

describe('suggestedBoxesToSend', () => {
  it('rounds the suggested ship units up to complete boxes', () => {
    expect(suggestedBoxesToSend(60, 60)).toBe(1);
    expect(suggestedBoxesToSend(61, 60)).toBe(2);
  });

  it('returns null without a usable ship quantity or pack size', () => {
    expect(suggestedBoxesToSend(null, 60)).toBeNull();
    expect(suggestedBoxesToSend(60, null)).toBeNull();
    expect(suggestedBoxesToSend(60, 0)).toBeNull();
  });
});

describe('SVD shipment email', () => {
  it('formats the shipment month in Los Angeles time', () => {
    const date = new Date('2026-08-01T01:00:00.000Z');

    expect(formatShipmentMonthYear(date)).toBe('July 2026');
  });

  it('builds the email with the current box counts', () => {
    const email = buildSvdShipmentEmail('August 2026', [
      { box: 'Blue cartons', numberOfBoxes: 2 },
      { box: 'Red cartons', numberOfBoxes: 1 },
    ]);

    expect(email).toBe(`Subject: B&E Medical August 2026 Shipment


Hi Julio,

See attached for box labels and pallet labels. They will be coming within 2 days to pick up the boxes.

Box | Number of Boxes
Blue cartons | 2
Red cartons | 1

As always please email or call me if you have any questions.

Kind regards,
Brian
5107171898`);
  });

  it('replaces a manual draft when a box count changes', () => {
    const rows = [
      row({
        sku: 'SKU-1',
        boxName: 'Blue cartons',
        svdUnitsPerBox: 60,
        sources: { amazonSideCounted: 20, svd: 500 },
      }),
    ];
    const initialCounts = initialSvdShipmentBoxCounts(rows, 30);
    const manuallyEditedDraft = 'Please preserve this manual edit';

    const next = applySvdShipmentBoxCount({
      monthYear: 'August 2026',
      rows,
      currentCounts: initialCounts,
      rowKey: svdShipmentRowKey(rows[0]),
      numberOfBoxes: 3,
    });

    expect(next.emailDraft).not.toBe(manuallyEditedDraft);
    expect(next.emailDraft).toContain('Blue cartons | 3');
  });

  it('changes the draft identity when refreshed shipment inputs change', () => {
    const before = [
      row({
        sku: 'SKU-1',
        boxName: 'Blue cartons',
        svdUnitsPerBox: 60,
        sources: { amazonSideCounted: 20, svd: 500 },
      }),
    ];
    const after = [
      row({
        sku: 'SKU-1',
        boxName: 'Blue cartons',
        svdUnitsPerBox: 60,
        sources: { amazonSideCounted: 80, svd: 500 },
      }),
    ];

    expect(svdShipmentDraftKey(before, 30, 'August 2026')).not.toBe(
      svdShipmentDraftKey(after, 30, 'August 2026'),
    );
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
