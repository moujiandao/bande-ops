import { describe, it, expect, vi } from 'vitest';
import { syncInventory, type SyncInventoryDeps } from './sync';
import { FakeAmazonClient } from '@/lib/amazon/fake-client';
import { DEFAULT_MARKETPLACE, type InventorySummary } from '@/lib/amazon/types';

// Sync orchestration: Amazon (source of truth) -> mirror upsert. We inject a
// FakeAmazonClient and a mocked admin client so there is no live network or DB.
// The mock captures the upsert payload + options so we can assert exactly what
// would be written, prove idempotency, and pin that UNKNOWN (null) is written
// as null — never 0.
//
// NOTE: import FakeAmazonClient from '@/lib/amazon/fake-client' directly, not
// the '@/lib/amazon' barrel, which pulls SpApiClient -> 'server-only'.

/** A mock admin client that records mirror writes and source-sync lifecycle writes. */
function makeAdminMock(upsertError: { message: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const sourceStateUpsert = vi.fn().mockResolvedValue({ error: null });
  const sourceRunInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
    }),
  });
  const sourceRunUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  upsert.mockResolvedValue({ data: null, error: upsertError });
  const from = vi.fn((table: string) => {
    if (table === 'inventory_levels') return { upsert };
    if (table === 'source_sync_state') return { upsert: sourceStateUpsert };
    if (table === 'source_sync_runs') {
      return { insert: sourceRunInsert, update: sourceRunUpdate };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return {
    admin: { from } as unknown as SyncInventoryDeps['admin'],
    from,
    upsert,
    sourceStateUpsert,
    sourceRunUpdate,
  };
}

describe('syncInventory', () => {
  it('upserts the FakeAmazonClient inventory into inventory_levels', async () => {
    const { admin, from, upsert } = makeAdminMock();
    const client = new FakeAmazonClient();

    const result = await syncInventory({ client, admin });

    // Wrote to the mirror table, keyed on the composite natural key.
    expect(from).toHaveBeenCalledWith('inventory_levels');
    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, options] = upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: 'marketplace_id,sku' });

    // Two seeded fake rows, each tagged US.
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { sku: string }) => r.sku)).toEqual([
      'BANDE-001',
      'BANDE-002',
    ]);
    for (const row of rows) {
      expect(row.marketplace_id).toBe(DEFAULT_MARKETPLACE.id);
      expect(typeof row.synced_at).toBe('string');
    }

    expect(result.count).toBe(2);
    expect(result.marketplaceId).toBe(DEFAULT_MARKETPLACE.id);
  });

  it('writes UNKNOWN (null) quantity as null in the upsert payload — never 0', async () => {
    const { admin, upsert } = makeAdminMock();
    await syncInventory({ client: new FakeAmazonClient(), admin });

    const [rows] = upsert.mock.calls[0];
    const known = rows.find((r: { sku: string }) => r.sku === 'BANDE-001');
    const unknown = rows.find((r: { sku: string }) => r.sku === 'BANDE-002');

    expect(known.total_quantity).toBe(42);
    expect(unknown.total_quantity).toBeNull();
    // The core invariant: UNKNOWN never silently becomes 0 on the write path.
    expect(unknown.total_quantity).not.toBe(0);
  });

  it('stamps every row in a sync with one shared synced_at', async () => {
    const { admin, upsert } = makeAdminMock();
    await syncInventory({ client: new FakeAmazonClient(), admin });

    const [rows] = upsert.mock.calls[0];
    const stamps = new Set(rows.map((r: { synced_at: string }) => r.synced_at));
    expect(stamps.size).toBe(1);
  });

  it('links mirror rows and successful source state to the sync run', async () => {
    const { admin, upsert, sourceStateUpsert } = makeAdminMock();

    await syncInventory({ client: new FakeAmazonClient(), admin });

    const [rows] = upsert.mock.calls[0];
    expect(rows.every((row: { sync_run_id: string }) => row.sync_run_id === 'run-1')).toBe(
      true,
    );
    expect(sourceStateUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'fba_inventory',
        status: 'success',
        current_success_run_id: 'run-1',
      }),
      { onConflict: 'source,marketplace_id' },
    );
  });

  it('is idempotent: re-running upserts the same key set, not duplicates', async () => {
    const seed: InventorySummary[] = [
      { sku: 'SEED-1', marketplaceId: DEFAULT_MARKETPLACE.id, totalQuantity: 3 },
      {
        sku: 'SEED-2',
        marketplaceId: DEFAULT_MARKETPLACE.id,
        totalQuantity: null,
      },
    ];
    const client = new FakeAmazonClient({ inventory: seed });
    const { admin, upsert } = makeAdminMock();

    await syncInventory({ client, admin });
    await syncInventory({ client, admin });

    expect(upsert).toHaveBeenCalledTimes(2);
    const firstKeys = upsert.mock.calls[0][0].map(
      (r: { marketplace_id: string; sku: string }) =>
        `${r.marketplace_id}:${r.sku}`,
    );
    const secondKeys = upsert.mock.calls[1][0].map(
      (r: { marketplace_id: string; sku: string }) =>
        `${r.marketplace_id}:${r.sku}`,
    );
    // Same composite keys both runs -> conflict target overwrites, no dupes.
    expect(secondKeys).toEqual(firstKeys);
    expect(new Set(secondKeys).size).toBe(secondKeys.length);
    // null survives a re-sync too.
    const reUnknown = upsert.mock.calls[1][0].find(
      (r: { sku: string }) => r.sku === 'SEED-2',
    );
    expect(reUnknown.total_quantity).toBeNull();
  });

  it('throws a clear error when the mirror upsert fails', async () => {
    const { admin, sourceRunUpdate } = makeAdminMock({ message: 'boom' });

    await expect(
      syncInventory({ client: new FakeAmazonClient(), admin }),
    ).rejects.toThrow(/mirror upsert failed: boom/);
    expect(sourceRunUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('passes the marketplace through to the Amazon client', async () => {
    const { admin } = makeAdminMock();
    const getSpy = vi.fn().mockResolvedValue([]);
    const client = { getInventorySummaries: getSpy };

    await syncInventory({ client, admin });

    expect(getSpy).toHaveBeenCalledWith({ marketplace: DEFAULT_MARKETPLACE });
  });
});
