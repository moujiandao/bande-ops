/**
 * Pure, framework-free helpers for the ads table's client-side UX: free-text
 * search and sort (by spend, by ACOS). Kept pure (no React, no Supabase) so the
 * behavior — especially the UNKNOWN invariant — is unit-testable in isolation
 * and the page component stays a thin renderer. Mirrors lib/catalog/view.ts.
 */

/** Minimal shape searchCampaigns needs: the two text-matchable columns. */
export interface SearchableCampaign {
  name: string;
  state: string;
}

/** Minimal shape sortBySpend needs: the (UNKNOWN-aware) spend. */
export interface SpendSortableRow {
  /** null = UNKNOWN (Amazon gave no number); must never sort as 0. */
  cost: number | null;
}

/** Minimal shape sortByAcos needs: the (UNKNOWN-aware) computed ACOS ratio. */
export interface AcosSortableRow {
  /** null = UNKNOWN (no spend/sales, or divide-by-zero); must never sort as 0. */
  acos: number | null;
}

export type SortDirection = 'asc' | 'desc';

/**
 * Case-insensitive substring filter over name / state.
 *
 * An empty or whitespace-only query returns the input rows unchanged (the
 * "no filter" state). Generic so callers keep their full row type — we only read
 * the two searchable fields.
 */
export function searchCampaigns<T extends SearchableCampaign>(
  rows: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return rows;

  return rows.filter((row) => {
    const haystack = `${row.name} ${row.state}`.toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Shared comparator core: sort by a nullable numeric field. KNOWN values order
 * by `dir` ('asc' = lowest first, 'desc' = highest first). UNKNOWN (null) is NOT
 * treated as 0 — it is parked at the END regardless of direction, so a null
 * never masquerades as the lowest (or highest). Returns a new array; the input
 * is not mutated; the sort is stable among equal rows (incl. all UNKNOWN rows).
 */
function sortByNullable<T>(
  rows: T[],
  dir: SortDirection,
  pick: (row: T) => number | null,
): T[] {
  const factor = dir === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = pick(a);
    const bv = pick(b);
    const aUnknown = av === null;
    const bUnknown = bv === null;

    // UNKNOWN always sinks to the bottom, independent of direction. Two UNKNOWNs
    // are equal (stable sort preserves their relative order).
    if (aUnknown && bUnknown) return 0;
    if (aUnknown) return 1;
    if (bUnknown) return -1;

    return ((av as number) - (bv as number)) * factor;
  });
}

/**
 * Sort rows by ad spend (cost). UNKNOWN spend sorts to the end, never as 0, so a
 * campaign with no reported spend never leads a lowest-first view.
 */
export function sortBySpend<T extends SpendSortableRow>(
  rows: T[],
  dir: SortDirection,
): T[] {
  return sortByNullable(rows, dir, (row) => row.cost);
}

/**
 * Sort rows by COMPUTED ACOS. UNKNOWN ACOS (null — no sales/spend or a
 * divide-by-zero) sorts to the end, never as 0, so it never masquerades as the
 * best (lowest) ACOS.
 */
export function sortByAcos<T extends AcosSortableRow>(
  rows: T[],
  dir: SortDirection,
): T[] {
  return sortByNullable(rows, dir, (row) => row.acos);
}
