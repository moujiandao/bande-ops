import { describe, it, expect, vi } from 'vitest';
import { syncCatalog, type SyncCatalogDeps } from './sync';
import { FakeAmazonClient } from '@/lib/amazon/fake-client';
import { DEFAULT_MARKETPLACE, type CatalogItem } from '@/lib/amazon/types';

// Sync orchestration: Amazon (source of truth) -> mirror upsert. We inject a
// FakeAmazonClient and a mocked admin client so there is no live network or DB.
// The mock captures the upsert payload + options so we can assert exactly what
// would be written, and re-run the sync to prove idempotency.
//
// NOTE: import FakeAmazonClient from '@/lib/amazon/fake-client' directly, not
// the '@/lib/amazon' barrel, which pulls SpApiClient -> 'server-only'.

/** A mock admin client exposing just `from().upsert()`, recording calls. */
function makeAdminMock() {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn().mockReturnValue({ upsert });
  return { admin: { from } as unknown as SyncCatalogDeps['admin'], from, upsert };
}

describe('syncCatalog SKU sourcing', () => {
  it('derives the SKU set from FBA inventory and looks up exactly those SKUs', async () => {
    // Catalog Items cannot enumerate a seller's products, so the SKU universe
    // comes from FBA inventory summaries.
    const { admin } = makeAdminMock();
    const listCatalogItems = vi.fn().mockResolvedValue([]);
    const getInventorySummaries = vi
      .fn()
      .mockResolvedValue([
        { sku: 'SKU-A', marketplaceId: 'ATVPDKIKX0DER', totalQuantity: 1 },
        { sku: 'SKU-B', marketplaceId: 'ATVPDKIKX0DER', totalQuantity: 0 },
      ]);

    await syncCatalog({
      client: { listCatalogItems, getInventorySummaries } as never,
      admin,
    });

    expect(getInventorySummaries).toHaveBeenCalled();
    expect(listCatalogItems).toHaveBeenCalledWith(
      expect.objectContaining({ sellerSkus: ['SKU-A', 'SKU-B'] }),
    );
  });

  it('keeps a row for every inventory SKU even when catalog returns nothing for it', async () => {
    // Amazon returns catalog data for only some SKUs. Dropping the rest would
    // silently remove them from /reorder instead of surfacing them for review.
    const { admin, upsert } = makeAdminMock();
    const listCatalogItems = vi
      .fn()
      .mockResolvedValue([{ sku: 'SKU-A', asin: 'ASIN-A', title: 'Item A' }]);
    const getInventorySummaries = vi
      .fn()
      .mockResolvedValue([{ sku: 'SKU-A' }, { sku: 'SKU-B' }]);

    await syncCatalog({
      client: { listCatalogItems, getInventorySummaries } as never,
      admin,
    });

    const [rows] = upsert.mock.calls[0];
    expect(rows.map((r: { sku: string }) => r.sku)).toEqual(['SKU-A', 'SKU-B']);
    expect(rows[1]).toMatchObject({ sku: 'SKU-B', asin: '', title: '' });
  });

  it('skips the catalog call entirely when inventory is empty', async () => {
    const { admin } = makeAdminMock();
    const listCatalogItems = vi.fn();
    const getInventorySummaries = vi.fn().mockResolvedValue([]);

    const result = await syncCatalog({
      client: { listCatalogItems, getInventorySummaries } as never,
      admin,
    });

    expect(listCatalogItems).not.toHaveBeenCalled();
    expect(result.count).toBe(0);
  });
});

describe('syncCatalog', () => {
  it('upserts the FakeAmazonClient catalog into catalog_items', async () => {
    const { admin, from, upsert } = makeAdminMock();
    const client = new FakeAmazonClient();

    const result = await syncCatalog({ client, admin });

    // Wrote to the mirror table, keyed on the composite natural key.
    expect(from).toHaveBeenCalledWith('catalog_items');
    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, options] = upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: 'marketplace_id,sku' });

    // Two seeded fake items, each mapped to a mirror row tagged US.
    expect(rows).toHaveLength(2);
    expect(rows.map((r: { sku: string }) => r.sku)).toEqual([
      'BANDE-001',
      'BANDE-002',
    ]);
    for (const row of rows) {
      expect(row.marketplace_id).toBe(DEFAULT_MARKETPLACE.id);
      expect(typeof row.synced_at).toBe('string');
    }
    // Missing image maps to null, present image carries through.
    expect(rows[0].image_url).toBe('https://example.invalid/a1.jpg');
    expect(rows[1].image_url).toBeNull();

    expect(result.count).toBe(2);
    expect(result.marketplaceId).toBe(DEFAULT_MARKETPLACE.id);
  });

  it('stamps every row in a sync with one shared synced_at', async () => {
    const { admin, upsert } = makeAdminMock();
    await syncCatalog({ client: new FakeAmazonClient(), admin });

    const [rows] = upsert.mock.calls[0];
    const stamps = new Set(rows.map((r: { synced_at: string }) => r.synced_at));
    expect(stamps.size).toBe(1);
  });

  it('is idempotent: re-running upserts the same key set, not duplicates', async () => {
    const seed: CatalogItem[] = [
      { sku: 'SEED-1', asin: 'A1', title: 'One' },
      { sku: 'SEED-2', asin: 'A2', title: 'Two', imageUrl: 'https://x/2.jpg' },
    ];
    const client = new FakeAmazonClient({ catalog: seed });
    const { admin, upsert } = makeAdminMock();

    await syncCatalog({ client, admin });
    await syncCatalog({ client, admin });

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
  });

  it('throws a clear error when the mirror upsert fails', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'boom' } });
    const from = vi.fn().mockReturnValue({ upsert });
    const admin = { from } as unknown as SyncCatalogDeps['admin'];

    await expect(
      syncCatalog({ client: new FakeAmazonClient(), admin }),
    ).rejects.toThrow(/mirror upsert failed: boom/);
  });

  it('passes the marketplace through to the Amazon client', async () => {
    const { admin } = makeAdminMock();
    const listSpy = vi.fn().mockResolvedValue([]);
    const getInventorySummaries = vi.fn().mockResolvedValue([{ sku: 'SKU-A' }]);
    const client = { listCatalogItems: listSpy, getInventorySummaries };

    await syncCatalog({ client: client as never, admin });

    expect(getInventorySummaries).toHaveBeenCalledWith({
      marketplace: DEFAULT_MARKETPLACE,
    });
    expect(listSpy).toHaveBeenCalledWith({
      marketplace: DEFAULT_MARKETPLACE,
      sellerSkus: ['SKU-A'],
    });
  });
});
