import { describe, it, expect } from 'vitest';
import {
  searchRows,
  sortByInventory,
  type SearchableRow,
  type InventorySortableRow,
} from './view';

// Pure helpers behind the catalog table's search + sort UX. The load-bearing
// invariant is in sortByInventory: an UNKNOWN (null) quantity must NOT be
// treated as 0 — it sorts to the end, never to the front of a lowest-first view.

const row = (over: Partial<SearchableRow>): SearchableRow => ({
  sku: 'SKU-1',
  asin: 'B000000001',
  title: 'A widget',
  ...over,
});

describe('searchRows', () => {
  const rows: SearchableRow[] = [
    { sku: 'ABC-123', asin: 'B00ALPHA01', title: 'Blue Yoga Mat' },
    { sku: 'XYZ-789', asin: 'B00BETA0002', title: 'Red Water Bottle' },
    { sku: 'MID-456', asin: 'B00GAMMA003', title: 'Green Yoga Block' },
  ];

  const cases: Array<{
    name: string;
    query: string;
    expectSkus: string[];
  }> = [
    {
      name: 'empty query returns all rows (no filter)',
      query: '',
      expectSkus: ['ABC-123', 'XYZ-789', 'MID-456'],
    },
    {
      name: 'whitespace-only query returns all rows',
      query: '   ',
      expectSkus: ['ABC-123', 'XYZ-789', 'MID-456'],
    },
    {
      name: 'matches on sku, case-insensitively',
      query: 'abc',
      expectSkus: ['ABC-123'],
    },
    {
      name: 'matches on asin',
      query: 'B00BETA',
      expectSkus: ['XYZ-789'],
    },
    {
      name: 'matches on title, case-insensitively',
      query: 'yoga',
      expectSkus: ['ABC-123', 'MID-456'],
    },
    {
      name: 'trims surrounding whitespace before matching',
      query: '  red  ',
      expectSkus: ['XYZ-789'],
    },
    {
      name: 'no match returns empty',
      query: 'nonexistent',
      expectSkus: [],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = searchRows(rows, c.query);
      expect(result.map((r) => r.sku)).toEqual(c.expectSkus);
    });
  }

  it('preserves the caller row type (generic passthrough)', () => {
    const tagged = [{ ...row({ sku: 'KEEP-1' }), extra: 42 }];
    const result = searchRows(tagged, 'keep');
    expect(result[0].extra).toBe(42);
  });

  it('does not mutate the input array', () => {
    const input = [...rows];
    searchRows(input, 'yoga');
    expect(input).toEqual(rows);
  });
});

describe('sortByInventory', () => {
  const make = (qty: number | null): InventorySortableRow => ({
    total_quantity: qty,
  });

  it('asc orders known quantities lowest first', () => {
    const result = sortByInventory([make(5), make(0), make(12)], 'asc');
    expect(result.map((r) => r.total_quantity)).toEqual([0, 5, 12]);
  });

  it('desc orders known quantities highest first', () => {
    const result = sortByInventory([make(5), make(0), make(12)], 'desc');
    expect(result.map((r) => r.total_quantity)).toEqual([12, 5, 0]);
  });

  it('UNKNOWN (null) is NOT treated as 0: it sorts to the END in asc', () => {
    // If null were folded to 0 it would lead a lowest-first sort. It must trail.
    const result = sortByInventory([make(null), make(3), make(0)], 'asc');
    expect(result.map((r) => r.total_quantity)).toEqual([0, 3, null]);
    expect(result[0].total_quantity).not.toBeNull();
  });

  it('UNKNOWN (null) also sorts to the END in desc (not as highest)', () => {
    const result = sortByInventory([make(null), make(3), make(0)], 'desc');
    expect(result.map((r) => r.total_quantity)).toEqual([3, 0, null]);
    expect(result[result.length - 1].total_quantity).toBeNull();
  });

  it('a true 0 sorts ahead of UNKNOWN — the two stay distinguishable', () => {
    const result = sortByInventory([make(null), make(0)], 'asc');
    expect(result.map((r) => r.total_quantity)).toEqual([0, null]);
  });

  it('keeps multiple UNKNOWN rows together at the end, stably', () => {
    const a = { total_quantity: null, id: 'a' };
    const b = { total_quantity: 7, id: 'b' };
    const c = { total_quantity: null, id: 'c' };
    const result = sortByInventory([a, b, c], 'asc');
    expect(result.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [make(5), make(1)];
    const snapshot = input.map((r) => r.total_quantity);
    sortByInventory(input, 'asc');
    expect(input.map((r) => r.total_quantity)).toEqual(snapshot);
  });
});
