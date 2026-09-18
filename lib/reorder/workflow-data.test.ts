import { describe, expect, it } from 'vitest';
import type { RecommendationRow } from './service';
import {
  REORDER_ANALYTICS_HISTORY_DAYS,
  transferCandidates,
} from './workflow-data';

it('uses the same 365-day best-evidence horizon as Advanced Analytics', () => {
  expect(REORDER_ANALYTICS_HISTORY_DAYS).toBe(365);
});

function row(
  recommendation: RecommendationRow['recommendation'],
): RecommendationRow {
  return {
    marketplaceId: 'ATVPDKIKX0DER',
    sku: 'SKU',
    title: 'Product',
    usableSupply: 100,
    dailyDemand: 4,
    velocitySampleDays: 90,
    sourceMapping: { status: 'mapped', svdItemId: 'SKU', mappingSource: 'sku' },
    isLegacy: false,
    sources: { fba: 10, awd: 0, svd: 120, fbaInbound: 0, amazonSideCounted: 10 },
    fbaBreakdown: {
      fcTransfer: 0,
      available: 10,
      reserved: 0,
      inboundWorking: 0,
      inboundShipped: 0,
      inboundReceiving: 0,
      researching: 0,
      unfulfillable: 0,
    },
    svdBoxes: 2,
    svdUnitsPerBox: 60,
    boxName: 'Carton',
    fnSku: null,
    supplyBreakdown: null,
    recommendation,
  };
}

describe('transferCandidates', () => {
  it('keeps source-blocked rows out of transfer recommendations', () => {
    const blocked = row({ status: 'needs-review', reason: 'stale-fba-inventory' });
    const safe = row({
      status: 'ok',
      recommendedQty: 0,
      reasoning: {
        usableSupply: 100,
        dailyDemand: 4,
        leadTimeDays: 14,
        safetyStock: 0,
        coverageDays: 90,
        reorderPoint: 56,
        targetStock: 360,
        orderUpToLevel: 360,
      },
    });

    expect(transferCandidates([blocked], 30)).toEqual([]);
    expect(transferCandidates([safe], 30)).toEqual([safe]);
  });
});
