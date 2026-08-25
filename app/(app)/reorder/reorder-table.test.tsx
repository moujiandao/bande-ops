import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RecommendationRow } from '@/lib/reorder/service';
import { ReorderTable } from './reorder-table';

function replenishRow(): RecommendationRow {
  return {
    marketplaceId: 'ATVPDKIKX0DER',
    sku: 'SKU-1',
    title: 'Product',
    usableSupply: 159,
    dailyDemand: 4,
    velocitySampleDays: 90,
    sourceMapping: {
      status: 'mapped',
      svdItemId: 'svd-1',
      mappingSource: 'sku',
    },
    isLegacy: false,
    sources: {
      fba: 59,
      awd: 0,
      svd: 100,
      fbaInbound: 0,
      amazonSideCounted: 59,
    },
    fbaBreakdown: {
      available: 59,
      reserved: 0,
      inboundWorking: 0,
      inboundShipped: 0,
      inboundReceiving: 0,
      researching: 0,
      unfulfillable: 0,
    },
    svdBoxes: 2,
    svdUnitsPerBox: 60,
    boxName: 'Blue cartons',
    fnSku: 'FNSKU-1',
    supplyBreakdown: null,
    recommendation: { status: 'needs-review', reason: 'test-fixture' },
  };
}

describe('ReorderTable replenish shipment fields', () => {
  it('renders the rounded-up box count immediately before Notes', () => {
    const html = renderToStaticMarkup(
      <ReorderTable
        rows={[replenishRow()]}
        trailingHeader="Ship"
        variant="replenish"
        svdToFbaTargetDays={30}
        shipmentMonthYear="August 2026"
      />,
    );

    const shipColumn = html.indexOf('>Ship<');
    const boxesColumn = html.indexOf('>Number of Boxes to send<');
    const notesColumn = html.indexOf('>Notes<');

    expect(shipColumn).toBeGreaterThan(-1);
    expect(boxesColumn).toBeGreaterThan(shipColumn);
    expect(notesColumn).toBeGreaterThan(boxesColumn);
    expect(html).toContain('aria-label="Number of boxes to send for SKU-1"');
    expect(html).toMatch(
      /aria-label="Number of boxes to send for SKU-1"[^>]*value="2"/,
    );
    expect(html).toContain('Blue cartons | 2');
  });
});
