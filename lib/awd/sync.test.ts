import { describe, expect, it, vi } from 'vitest';
import { syncAwdInventory, type SyncAwdInventoryDeps } from './sync';
import { FakeAmazonClient } from '@/lib/amazon/fake-client';
import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';

function makeAdminMock(upsertError: { message: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: upsertError });
  const sourceStateUpsert = vi.fn().mockResolvedValue({ error: null });
  const sourceRunInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
    }),
  });
  const sourceRunUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  const from = vi.fn((table: string) => {
    if (table === 'awd_inventory_levels') return { upsert };
    if (table === 'source_sync_state') return { upsert: sourceStateUpsert };
    if (table === 'source_sync_runs') {
      return { insert: sourceRunInsert, update: sourceRunUpdate };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return {
    admin: { from } as unknown as SyncAwdInventoryDeps['admin'],
    from,
    upsert,
    sourceStateUpsert,
    sourceRunUpdate,
  };
}

describe('syncAwdInventory', () => {
  it('upserts AWD rows with their producing sync run and records success', async () => {
    const { admin, from, upsert, sourceStateUpsert } = makeAdminMock();

    const result = await syncAwdInventory({
      client: new FakeAmazonClient(),
      admin,
    });

    expect(from).toHaveBeenCalledWith('awd_inventory_levels');
    expect(upsert).toHaveBeenCalledWith(expect.any(Array), {
      onConflict: 'marketplace_id,sku',
    });
    const [rows] = upsert.mock.calls[0];
    expect(rows).toMatchObject([
      {
        sku: 'BANDE-001',
        replenishment_quantity: 25,
        sync_run_id: 'run-1',
      },
    ]);
    expect(sourceStateUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'awd_inventory',
        status: 'success',
        current_success_run_id: 'run-1',
      }),
      { onConflict: 'source,marketplace_id' },
    );
    expect(result).toMatchObject({
      count: 1,
      marketplaceId: DEFAULT_MARKETPLACE.id,
    });
  });

  it('records failure when the AWD mirror upsert fails', async () => {
    const { admin, sourceRunUpdate } = makeAdminMock({ message: 'boom' });

    await expect(
      syncAwdInventory({ client: new FakeAmazonClient(), admin }),
    ).rejects.toThrow(/mirror upsert failed: boom/);

    expect(sourceRunUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
