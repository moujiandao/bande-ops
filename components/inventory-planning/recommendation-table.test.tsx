import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RecommendationRow } from '@/lib/reorder/service';
import {
  copyEmailDraft,
  emailClipboardBlobs,
  usableSupplyWithMisc,
  orderQuantityForCoverage,
  RecommendationTable,
  FbaBreakdown,
} from './recommendation-table';

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
      fcTransfer: 0,
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

function orderRow(): RecommendationRow {
  return {
    ...replenishRow(),
    usableSupply: 50,
    dailyDemand: 2,
    recommendation: {
      status: 'ok',
      recommendedQty: 130,
      reasoning: {
        usableSupply: 50,
        dailyDemand: 2,
        leadTimeDays: 30,
        safetyStock: 0,
        coverageDays: 90,
        reorderPoint: 60,
        targetStock: 180,
        orderUpToLevel: 180,
      },
    },
  };
}

describe('RecommendationTable coverage selector', () => {
  it('adds a reorder-only misc-units input between SVD and Total', () => {
    const html = renderToStaticMarkup(
      <RecommendationTable rows={[orderRow()]} trailingHeader="Order" variant="order" />,
    );

    const svdColumn = html.indexOf('>SVD<');
    const miscColumn = html.indexOf('>Additional misc units<');
    const totalColumn = html.indexOf('>Total<');
    expect(miscColumn).toBeGreaterThan(svdColumn);
    expect(totalColumn).toBeGreaterThan(miscColumn);
    expect(html).toContain('aria-label="Additional misc units for SKU-1"');
    expect(html).toContain('placeholder="0"');

    const statusHtml = renderToStaticMarkup(
      <RecommendationTable rows={[orderRow()]} trailingHeader="Status" variant="status" />,
    );
    expect(statusHtml).not.toContain('Additional misc units');
  });

  it('offers an archive action for each row', () => {
    const html = renderToStaticMarkup(
      <RecommendationTable rows={[orderRow()]} trailingHeader="Order" variant="order" />,
    );

    expect(html).toContain('>Archive</th>');
    expect(html).toContain('name="sku" value="SKU-1"');
    expect(html).toContain('aria-label="Archive SKU-1"');
  });

  it('links an actionable row to its dated analytics evidence', () => {
    const signal = {
      kind: 'trending-up' as const,
      label: 'Trending up +50%',
      absoluteChange: 1,
      percentageChange: 50,
      recentVelocity: 3,
      previousVelocity: 2,
      recentStartDate: '2026-09-11',
      recentEndDate: '2026-09-17',
      previousStartDate: '2026-09-04',
      previousEndDate: '2026-09-10',
      bestVelocity: 4.2,
      bestStartDate: '2026-08-08',
      bestEndDate: '2026-08-14',
    };
    const html = renderToStaticMarkup(
      <RecommendationTable
        rows={[orderRow()]}
        trailingHeader="Order"
        variant="order"
        momentumBySku={{ 'SKU-1': signal }}
      />,
    );

    const bestColumn = html.indexOf('>Best<');
    const signalColumn = html.indexOf('>Signal<');
    const bestDatesColumn = html.indexOf('>Best dates<');
    expect(bestColumn).toBeGreaterThan(-1);
    expect(signalColumn).toBeGreaterThan(bestColumn);
    expect(bestDatesColumn).toBeGreaterThan(signalColumn);
    expect(html).toContain('href="/analytics?sku=SKU-1"');
    expect(html).toContain('Trending up +50%');
    expect(html).toContain('Recent 2026-09-11 to 2026-09-17');
    expect(html).toContain('>4.2</td>');
    expect(html).toContain('>2026-08-08 to 2026-08-14</td>');

    const replenishHtml = renderToStaticMarkup(
      <RecommendationTable
        rows={[replenishRow()]}
        trailingHeader="Ship"
        variant="replenish"
        svdToFbaTargetDays={30}
        shipmentMonthYear="August 2026"
        userId="user-1"
        momentumBySku={{ 'SKU-1': signal }}
      />,
    );
    expect(replenishHtml).toContain('>Momentum<');
    expect(replenishHtml).not.toContain('>Best dates<');
  });

  it('offers the legacy coverage presets on the order list only', () => {
    const html = renderToStaticMarkup(
      <RecommendationTable rows={[orderRow()]} trailingHeader="Order" variant="order" />,
    );

    expect(html).toContain('aria-label="Months of coverage"');
    expect(html).toContain('>Total cover<');
    expect(html).toMatch(
      /<option value=""[^>]*>Use SKU settings<\/option>/,
    );
    for (const months of [1, 2, 3, 6, 12]) {
      expect(html).toContain(`<option value="${months}">${months} month`);
    }

    const replenishHtml = renderToStaticMarkup(
      <RecommendationTable
        rows={[replenishRow()]}
        trailingHeader="Ship"
        variant="replenish"
        svdToFbaTargetDays={30}
        shipmentMonthYear="August 2026"
        userId="user-1"
      />,
    );
    expect(replenishHtml).not.toContain('aria-label="Months of coverage"');
  });

  it('recalculates quantity from the selected coverage without changing the trigger', () => {
    const row = orderRow();

    expect(orderQuantityForCoverage(row, null)).toBe(130);
    expect(orderQuantityForCoverage(row, 30)).toBe(10);
    expect(orderQuantityForCoverage(row, 180)).toBe(310);
    expect(row.recommendation).toMatchObject({ recommendedQty: 130 });
  });

  it('counts additional misc units in total, cover, and suggested order', () => {
    const row = orderRow();

    expect(usableSupplyWithMisc(row, '')).toBe(50);
    expect(usableSupplyWithMisc(row, 20)).toBe(70);
    expect(orderQuantityForCoverage(row, null, 5)).toBe(125);
    // 70 units exceeds the 60-unit reorder point, so this scenario no longer
    // triggers an order even though it remains below the 90-day target.
    expect(orderQuantityForCoverage(row, null, 20)).toBe(0);
    expect(row.usableSupply).toBe(50);
  });

  it('preserves unknown supply instead of letting a manual value manufacture a recommendation', () => {
    const row = orderRow();
    row.usableSupply = null;
    row.recommendation = { status: 'needs-review', reason: 'unknown-usable-supply' };

    expect(usableSupplyWithMisc(row, 100)).toBeNull();
    expect(orderQuantityForCoverage(row, null, 100)).toBeNull();
  });
});

describe('RecommendationTable replenish shipment fields', () => {
  it('renders the rounded-up box count immediately before Notes', () => {
    const html = renderToStaticMarkup(
      <RecommendationTable
        rows={[replenishRow()]}
        trailingHeader="Ship"
        variant="replenish"
        svdToFbaTargetDays={30}
        shipmentMonthYear="August 2026"
        userId="user-1"
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
    expect(html).toContain('>Blue cartons</td>');
  });

  it('labels transfer coverage as Amazon cover and excludes total usable supply', () => {
    const html = renderToStaticMarkup(
      <RecommendationTable
        rows={[replenishRow()]}
        trailingHeader="Suggested units"
        variant="replenish"
        svdToFbaTargetDays={30}
        shipmentMonthYear="August 2026"
        userId="user-1"
      />,
    );

    expect(html).toContain('>Amazon cover<');
    expect(html).not.toContain('>Total<');
    // 59 units counted at Amazon / 4 daily units = 14 days. The 100 SVD units
    // are deliberately excluded from this transfer-specific coverage value.
    expect(html).toContain('>14</td>');
  });

  it('renders an editable email with a bordered grid and copy button', () => {
    const html = renderToStaticMarkup(
      <RecommendationTable
        rows={[replenishRow()]}
        trailingHeader="Ship"
        variant="replenish"
        svdToFbaTargetDays={30}
        shipmentMonthYear="August 2026"
        userId="user-1"
      />,
    );

    expect(html).toContain('contentEditable="true"');
    expect(html).toContain('aria-label="Shipment box counts"');
    expect(html).toContain('border:1px solid');
    expect(html).toContain('>Copy email<');
    expect(html).not.toContain('<textarea');
  });

  it('provides HTML and plain-text clipboard formats', async () => {
    const blobs = emailClipboardBlobs(
      '<table><tr><td>Blue cartons</td><td>2</td></tr></table>',
      'Blue cartons 2',
    );

    expect(await blobs['text/html'].text()).toBe(
      '<table><tr><td>Blue cartons</td><td>2</td></tr></table>',
    );
    expect(await blobs['text/plain'].text()).toBe('Blue cartons 2');
  });

  it('copies current editable content as rich HTML and plain text', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    class ClipboardItemStub {
      constructor(public readonly items: Record<string, Blob>) {}
    }

    const result = await copyEmailDraft(
      {
        innerHTML: '<p>Manually edited <strong>email</strong></p>',
        innerText: 'Manually edited email',
      },
      { write, writeText },
      ClipboardItemStub as unknown as typeof ClipboardItem,
    );

    expect(result).toBe('rich');
    expect(writeText).not.toHaveBeenCalled();
    const item = write.mock.calls[0]?.[0][0] as ClipboardItemStub;
    expect(await item.items['text/html'].text()).toBe(
      '<p>Manually edited <strong>email</strong></p>',
    );
    expect(await item.items['text/plain'].text()).toBe(
      'Manually edited email',
    );
  });

  it('falls back to plain text when rich clipboard items are unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      copyEmailDraft(
        { innerHTML: '<p>Edited</p>', innerText: 'Edited' },
        { write: vi.fn(), writeText },
      ),
    ).resolves.toBe('plain');

    expect(writeText).toHaveBeenCalledWith('Edited');
  });
});


describe('FBA on-hand display', () => {
  const row = replenishRow();
  row.sources.fba = 3431;
  row.fbaBreakdown = {
    available: 427, fcTransfer: 3004, reserved: 3187,
    inboundWorking: 0, inboundShipped: 0, inboundReceiving: 0,
    researching: 10, unfulfillable: 5,
  };

  it.each(['order', 'status', 'legacy', 'replenish'] as const)('shows the same expandable on-hand count in %s', (variant) => {
    const html = renderToStaticMarkup(<RecommendationTable rows={[row]} trailingHeader="Status" variant={variant} svdToFbaTargetDays={90} shipmentMonthYear="September 2026" userId="user-1" />);
    expect(html).toContain('>FBA on-hand<');
    expect(html).toContain('aria-label="FBA on-hand for SKU-1: 3431 units. Show breakdown"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('explains available and transferring units and removes transfers from reserved', () => {
    const html = renderToStaticMarkup(<FbaBreakdown row={row} />);
    expect(html).toContain('Available now');
    expect(html).toContain('>427</span>');
    expect(html).toContain('FC transfer (buyable)');
    expect(html).toContain('>3004</span>');
    expect(html).toContain('>183</span>');
    expect(html).not.toContain('>3187</span>');
    expect(html).toContain('On-hand = Available now + FC transfer');
  });
});


it('gives duplicate SKU rows in separate tables distinct breakdown controls', () => {
  const row = replenishRow();
  const html = renderToStaticMarkup(<><RecommendationTable rows={[row]} variant="status" trailingHeader="Status"/><RecommendationTable rows={[row]} variant="status" trailingHeader="Status"/></>);
  const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
  expect(controls).toHaveLength(2);
  expect(new Set(controls).size).toBe(2);
});
