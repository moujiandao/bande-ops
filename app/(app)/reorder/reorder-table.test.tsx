import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RecommendationRow } from '@/lib/reorder/service';
import {
  copyEmailDraft,
  emailClipboardBlobs,
  ReorderTable,
} from './reorder-table';

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
    expect(html).toContain('>Blue cartons</td>');
  });

  it('renders an editable email with a bordered grid and copy button', () => {
    const html = renderToStaticMarkup(
      <ReorderTable
        rows={[replenishRow()]}
        trailingHeader="Ship"
        variant="replenish"
        svdToFbaTargetDays={30}
        shipmentMonthYear="August 2026"
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
