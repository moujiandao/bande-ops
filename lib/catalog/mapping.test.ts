import { describe, it, expect } from 'vitest';
import { mapCatalogItemToRow, mapCatalogItemsToRows } from './mapping';
import { DEFAULT_MARKETPLACE, type CatalogItem } from '@/lib/amazon/types';

// The pure mapping is the load-bearing seam between Amazon's shape and our
// mirror table. These tests pin the column names, the US marketplace default,
// the nullable image, and the single-timestamp-per-batch behavior — all without
// a DB.

const FIXED = new Date('2026-06-26T12:00:00.000Z');

describe('mapCatalogItemToRow', () => {
  it('maps a CatalogItem to a snake_case catalog_items row', () => {
    const item: CatalogItem = {
      sku: 'BANDE-001',
      asin: 'B0000000A1',
      title: 'Bande Test Widget A',
      imageUrl: 'https://example.invalid/a1.jpg',
    };

    const row = mapCatalogItemToRow(item, { syncedAt: FIXED });

    expect(row).toEqual({
      marketplace_id: DEFAULT_MARKETPLACE.id,
      sku: 'BANDE-001',
      asin: 'B0000000A1',
      title: 'Bande Test Widget A',
      image_url: 'https://example.invalid/a1.jpg',
      synced_at: FIXED.toISOString(),
    });
  });

  it('defaults marketplace_id to US when none is provided', () => {
    const row = mapCatalogItemToRow(
      { sku: 'S', asin: 'A', title: 'T' },
      { syncedAt: FIXED },
    );
    expect(row.marketplace_id).toBe('ATVPDKIKX0DER');
    expect(row.marketplace_id).toBe(DEFAULT_MARKETPLACE.id);
  });

  it('represents a missing image as null (never undefined/empty string)', () => {
    const row = mapCatalogItemToRow(
      { sku: 'S', asin: 'A', title: 'T' },
      { syncedAt: FIXED },
    );
    expect(row.image_url).toBeNull();
  });

  it('honors an explicit marketplace_id override', () => {
    const row = mapCatalogItemToRow(
      { sku: 'S', asin: 'A', title: 'T' },
      { marketplaceId: 'A1OTHER', syncedAt: FIXED },
    );
    expect(row.marketplace_id).toBe('A1OTHER');
  });
});

describe('mapCatalogItemsToRows', () => {
  it('stamps every row in a batch with the same synced_at', () => {
    const items: CatalogItem[] = [
      { sku: 'S1', asin: 'A1', title: 'T1' },
      { sku: 'S2', asin: 'A2', title: 'T2', imageUrl: 'https://x/2.jpg' },
    ];

    const rows = mapCatalogItemsToRows(items, { syncedAt: FIXED });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.synced_at)).size).toBe(1);
    expect(rows[0].synced_at).toBe(FIXED.toISOString());
    expect(rows[1].image_url).toBe('https://x/2.jpg');
  });

  it('returns an empty array for an empty catalog', () => {
    expect(mapCatalogItemsToRows([], { syncedAt: FIXED })).toEqual([]);
  });
});
