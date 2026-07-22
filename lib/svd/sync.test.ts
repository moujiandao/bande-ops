import { describe, expect, it, vi } from 'vitest';
import { refreshSvdInventory, type RefreshSvdInventoryDeps } from './sync';

function makeAdminMock() {
  const inventoryUpsert = vi.fn().mockResolvedValue({ error: null });
  const inventoryDeleteOr = vi.fn().mockResolvedValue({ error: null });
  const inventoryDelete = vi.fn().mockReturnValue({ or: inventoryDeleteOr });
  const stateUpsert = vi.fn().mockResolvedValue({ error: null });
  const runInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
    }),
  });
  const runUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  const from = vi.fn((table: string) => {
    if (table === 'source_sync_runs') {
      return { insert: runInsert, update: runUpdate };
    }
    if (table === 'source_sync_state') return { upsert: stateUpsert };
    if (table === 'svd_inventory_levels') {
      return { upsert: inventoryUpsert, delete: inventoryDelete };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    admin: { from } as unknown as RefreshSvdInventoryDeps['admin'],
    inventoryUpsert,
    inventoryDeleteOr,
    stateUpsert,
  };
}

describe('refreshSvdInventory', () => {
  it('writes parsed rows and records success', async () => {
    const { admin, inventoryUpsert, inventoryDeleteOr, stateUpsert } =
      makeAdminMock();

    const result = await refreshSvdInventory({
      admin,
      client: {
        fetchInventoryHtml: vi.fn().mockResolvedValue(`
          <table>
            <tr><th>Item ID:</th><th>Description:</th><th>Availability:</th></tr>
            <tr><td>svd-1</td><td>Item 1</td><td>4</td></tr>
          </table>
        `),
      },
    });

    expect(inventoryUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          svd_item_id: 'svd-1',
          description: 'Item 1',
          quantity: 4,
          sync_run_id: 'run-1',
        }),
      ],
      { onConflict: 'svd_item_id' },
    );
    expect(stateUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'svd_inventory',
        status: 'success',
        current_success_run_id: 'run-1',
      }),
      { onConflict: 'source,marketplace_id' },
    );
    expect(inventoryDeleteOr).toHaveBeenCalledWith(
      'sync_run_id.is.null,sync_run_id.neq.run-1',
    );
    expect(result).toEqual({ count: 1, syncRunId: 'run-1' });
  });

  it('records sanitized failure state without replacing rows', async () => {
    const { admin, inventoryUpsert, inventoryDeleteOr, stateUpsert } =
      makeAdminMock();

    await expect(
      refreshSvdInventory({
        admin,
        client: {
          fetchInventoryHtml: vi
            .fn()
            .mockRejectedValue(new Error('svd password raw response')),
        },
      }),
    ).rejects.toThrow('svd password raw response');

    expect(inventoryUpsert).not.toHaveBeenCalled();
    expect(inventoryDeleteOr).not.toHaveBeenCalled();
    expect(stateUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'svd_inventory',
        status: 'failed',
        error_summary: 'Sync failed; check server logs for details.',
      }),
      { onConflict: 'source,marketplace_id' },
    );
  });

  it('records sanitized failure state when parsing returns zero rows', async () => {
    const { admin, inventoryUpsert, inventoryDeleteOr, stateUpsert } =
      makeAdminMock();

    await expect(
      refreshSvdInventory({
        admin,
        client: {
          fetchInventoryHtml: vi.fn().mockResolvedValue('<table></table>'),
        },
      }),
    ).rejects.toThrow('SVD inventory parse returned zero rows.');

    expect(inventoryUpsert).not.toHaveBeenCalled();
    expect(inventoryDeleteOr).not.toHaveBeenCalled();
    expect(stateUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'svd_inventory',
        status: 'failed',
        error_summary: 'Sync failed; check server logs for details.',
      }),
      { onConflict: 'source,marketplace_id' },
    );
  });
});
