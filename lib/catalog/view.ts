/**
 * Pure, framework-free helpers for the catalog table's client-side UX: free-text
 * search and sort-by-inventory. Kept pure (no React, no Supabase) so the
 * behavior — especially the UNKNOWN-stock invariant — is unit-testable in
 * isolation and the page component stays a thin renderer.
 */

/** Minimal shape searchRows needs: the three text-matchable columns. */
export interface SearchableRow {
  sku: string;
  asin: string;
  title: string;
}

/** Minimal shape sortByInventory needs: the (UNKNOWN-aware) quantity. */
export interface InventorySortableRow {
  /** null = UNKNOWN (Amazon gave no number); must never sort as 0. */
  total_quantity: number | null;
}

export type SortDirection = 'asc' | 'desc';

/**
 * Case-insensitive substring filter over sku / asin / title.
 *
 * An empty or whitespace-only query returns the input rows unchanged (the
 * "no filter" state). Generic so callers keep their full row type — we only
 * read the three searchable fields.
 */
export function searchRows<T extends SearchableRow>(
  rows: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return rows;

  return rows.filter((row) => {
    const haystack = `${row.sku} ${row.asin} ${row.title}`.toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Sort rows by inventory quantity. `dir` orders the KNOWN numeric levels
 * ('asc' = lowest first, the default control; 'desc' = highest first).
 *
 * UNKNOWN (null) is NOT treated as 0: it is parked at the END regardless of
 * direction, so a null never masquerades as the lowest (or highest) stock. This
 * keeps the "lowest first" view honest — real low-stock SKUs surface at the top,
 * and the un-numbered ones trail behind instead of polluting the front.
 *
 * Returns a new array; the input is not mutated. The sort is stable among rows
 * that compare equal (incl. all the UNKNOWN rows, which keep their prior order).
 */
export function sortByInventory<T extends InventorySortableRow>(
  rows: T[],
  dir: SortDirection,
): T[] {
  const factor = dir === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const aUnknown = a.total_quantity === null;
    const bUnknown = b.total_quantity === null;

    // UNKNOWN always sinks to the bottom, independent of direction. Two UNKNOWNs
    // are equal (stable sort preserves their relative order).
    if (aUnknown && bUnknown) return 0;
    if (aUnknown) return 1;
    if (bUnknown) return -1;

    return ((a.total_quantity as number) - (b.total_quantity as number)) * factor;
  });
}
