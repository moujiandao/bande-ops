// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecommendationRow } from '@/lib/reorder/service';
import { RecommendationTable, type RecommendationTableVariant } from './recommendation-table';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const sku = 'pediatrics_notebook_tall_single';
const row: RecommendationRow = {
  marketplaceId: 'ATVPDKIKX0DER',
  sku,
  title: 'Pediatrics notebook',
  imageUrl: null,
  usableSupply: 10,
  dailyDemand: 1,
  velocitySampleDays: 90,
  sourceMapping: { status: 'mapped', svdItemId: sku, mappingSource: 'sku' },
  isLegacy: false,
  sources: { fba: 10, awd: 0, svd: 0, fbaInbound: 0, amazonSideCounted: 10 },
  fbaBreakdown: {
    fcTransfer: 0, available: 10, reserved: 0, inboundWorking: 0,
    inboundShipped: 0, inboundReceiving: 0, researching: 0, unfulfillable: 0,
  },
  svdBoxes: 0,
  svdUnitsPerBox: 1,
  boxName: 'Carton',
  fnSku: null,
  supplyBreakdown: null,
  recommendation: { status: 'needs-review', reason: 'test-fixture' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SKU copy button', () => {
  it.each(['order', 'status', 'legacy', 'replenish'] as RecommendationTableVariant[])(
    'appears beside the SKU in %s rows and nowhere else',
    (variant) => {
      const html = renderToStaticMarkup(
        <RecommendationTable
          rows={[row]}
          trailingHeader="Status"
          variant={variant}
          userId={variant === 'replenish' ? 'user-1' : undefined}
          svdToFbaTargetDays={variant === 'replenish' ? 90 : undefined}
          shipmentMonthYear={variant === 'replenish' ? 'September 2026' : undefined}
        />,
      );
      expect(html).toContain(`aria-label="Copy SKU ${sku}"`);
      expect(html.match(/aria-label="Copy SKU /g)).toHaveLength(1);
      expect(html).toContain(`<span class="truncate font-mono">${sku}</span><button`);
    },
  );

  it('copies the full SKU and reports success or failure without submitting a form', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);

    try {
      await act(async () => {
        root.render(<RecommendationTable rows={[row]} trailingHeader="Status" variant="status" />);
      });
      const button = mount.querySelector<HTMLButtonElement>(`button[aria-label="Copy SKU ${sku}"]`);
      expect(button?.type).toBe('button');

      await act(async () => button?.click());
      expect(writeText).toHaveBeenCalledWith(sku);
      expect(mount.querySelector('[role="status"]')?.textContent).toBe(`Copied SKU ${sku}`);

      await act(async () => button?.click());
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(mount.querySelector('[role="status"]')?.textContent).toBe(`Could not copy SKU ${sku}`);
    } finally {
      await act(async () => root.unmount());
      mount.remove();
    }
  });
});
