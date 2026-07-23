import { describe, expect, it } from 'vitest';
import { mapAwdInventoryToRows } from './mapping';

describe('mapAwdInventoryToRows', () => {
  it('maps AWD replenishment quantity without treating unknown as zero', () => {
    const rows = mapAwdInventoryToRows(
      [
        {
          sku: 'SKU-1',
          marketplaceId: 'ATVPDKIKX0DER' as never,
          fnSku: 'FNSKU-1',
          replenishmentQuantity: 12,
          availableDistributableQuantity: null,
          totalQuantity: null,
          inboundQuantity: null,
        },
      ],
      { syncedAt: new Date('2026-07-21T00:00:00.000Z'), syncRunId: 'run-1' },
    );

    expect(rows).toEqual([
      {
        marketplace_id: 'ATVPDKIKX0DER',
        sku: 'SKU-1',
        fn_sku: 'FNSKU-1',
        replenishment_quantity: 12,
        available_distributable_quantity: null,
        inbound_quantity: null,
        total_quantity: null,
        synced_at: '2026-07-21T00:00:00.000Z',
        sync_run_id: 'run-1',
      },
    ]);
  });
});
