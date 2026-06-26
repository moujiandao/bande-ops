import { describe, it, expect } from 'vitest';
import {
  mapInventorySummaryToRow,
  mapInventorySummariesToRows,
} from './mapping';
import { DEFAULT_MARKETPLACE, type InventorySummary } from '@/lib/amazon/types';

// The pure mapping is the load-bearing seam between Amazon's inventory shape and
// our mirror table. These tests pin the column names, the US default, the
// nullable fn_sku, single-timestamp-per-batch — and, most importantly, that an
// UNKNOWN (null) quantity is preserved as null and NEVER coerced to 0.

const FIXED = new Date('2026-06-26T12:00:00.000Z');

describe('mapInventorySummaryToRow', () => {
  it('maps an InventorySummary to a snake_case inventory_levels row', () => {
    const summary: InventorySummary = {
      sku: 'BANDE-001',
      marketplaceId: DEFAULT_MARKETPLACE.id,
      totalQuantity: 42,
      fnSku: 'X000111AAA',
    };

    const row = mapInventorySummaryToRow(summary, { syncedAt: FIXED });

    expect(row).toEqual({
      marketplace_id: DEFAULT_MARKETPLACE.id,
      sku: 'BANDE-001',
      total_quantity: 42,
      fn_sku: 'X000111AAA',
      synced_at: FIXED.toISOString(),
    });
  });

  it('preserves UNKNOWN (null) quantity as null — NEVER 0', () => {
    const summary: InventorySummary = {
      sku: 'BANDE-002',
      marketplaceId: DEFAULT_MARKETPLACE.id,
      totalQuantity: null,
    };

    const row = mapInventorySummaryToRow(summary, { syncedAt: FIXED });

    expect(row.total_quantity).toBeNull();
    // The whole point of the convention: null is distinct from a true zero.
    expect(row.total_quantity).not.toBe(0);
  });

  it('keeps a true 0 as 0 (in-stock-zero is not UNKNOWN)', () => {
    const row = mapInventorySummaryToRow(
      { sku: 'S', marketplaceId: DEFAULT_MARKETPLACE.id, totalQuantity: 0 },
      { syncedAt: FIXED },
    );
    expect(row.total_quantity).toBe(0);
    expect(row.total_quantity).not.toBeNull();
  });

  it('represents a missing fn_sku as null (never undefined)', () => {
    const row = mapInventorySummaryToRow(
      { sku: 'S', marketplaceId: DEFAULT_MARKETPLACE.id, totalQuantity: 1 },
      { syncedAt: FIXED },
    );
    expect(row.fn_sku).toBeNull();
  });

  it('defaults marketplace_id to US when neither opt nor summary supplies one', () => {
    const row = mapInventorySummaryToRow(
      // Force-cast: simulate a summary missing its marketplace dimension.
      { sku: 'S', totalQuantity: 1 } as unknown as InventorySummary,
      { syncedAt: FIXED },
    );
    expect(row.marketplace_id).toBe('ATVPDKIKX0DER');
    expect(row.marketplace_id).toBe(DEFAULT_MARKETPLACE.id);
  });

  it('honors an explicit marketplace_id override', () => {
    const row = mapInventorySummaryToRow(
      { sku: 'S', marketplaceId: DEFAULT_MARKETPLACE.id, totalQuantity: 1 },
      { marketplaceId: 'A1OTHER', syncedAt: FIXED },
    );
    expect(row.marketplace_id).toBe('A1OTHER');
  });
});

describe('mapInventorySummariesToRows', () => {
  it('stamps every row in a batch with the same synced_at and preserves nulls', () => {
    const summaries: InventorySummary[] = [
      { sku: 'S1', marketplaceId: DEFAULT_MARKETPLACE.id, totalQuantity: 7 },
      { sku: 'S2', marketplaceId: DEFAULT_MARKETPLACE.id, totalQuantity: null },
    ];

    const rows = mapInventorySummariesToRows(summaries, { syncedAt: FIXED });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.synced_at)).size).toBe(1);
    expect(rows[0].total_quantity).toBe(7);
    expect(rows[1].total_quantity).toBeNull();
    expect(rows[1].total_quantity).not.toBe(0);
  });

  it('returns an empty array for empty inventory', () => {
    expect(mapInventorySummariesToRows([], { syncedAt: FIXED })).toEqual([]);
  });
});
