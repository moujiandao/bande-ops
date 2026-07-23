/**
 * FBA ledger MSKU truncation reconciliation (issue #27, last piece).
 *
 * Amazon truncates long MSKUs in the FBA ledger report
 * (`GET_LEDGER_SUMMARY_VIEW_DATA`). A truncated MSKU won't exact-match any
 * `catalog_items.sku`, so downstream `sales_velocity` → `catalog_items` joins
 * (`lib/reorder`) silently drop velocity and surface the item as "Needs
 * review". This pure module reconciles a (possibly truncated) ledger MSKU back
 * to its canonical catalog SKU, but ONLY when a confident, unambiguous match
 * exists — a wrong join corrupts reorder numbers, which is the exact failure
 * this repo exists to prevent.
 *
 * Pure: no DB/IO. The sync (`sync.ts`) loads the catalog SKU set and applies
 * this before per-SKU velocity grouping/upsert.
 *
 * Reconciliation rules, in priority order, for a raw MSKU that is NOT already
 * an exact catalog SKU:
 *   0. Exact catalog SKU              → pass through unchanged.
 *   1. FNSKU cross-reference          → if the row's FNSKU maps to exactly one
 *                                        catalog SKU, use it.
 *   2. Unique prefix match            → if the truncated MSKU is a prefix of
 *                                        exactly one catalog SKU, use it.
 *   3. Ambiguous (2+ candidates) or   → leave the raw MSKU (downstream then
 *      no match                          correctly surfaces "Needs review").
 */

export interface CatalogSkuEntry {
  sku: string;
  /**
   * The catalog row's FNSKU, if the schema carries one. `catalog_items` does
   * NOT currently have an fn_sku column, so the sync passes none and rule 1
   * stays dormant; the parameter keeps the pure logic complete and testable
   * for when/if a catalog FNSKU source is added.
   */
  fnSku?: string | null;
}

export interface ReconcilableRow {
  sku: string;
  fn_sku: string | null;
}

export interface CatalogSkuIndex {
  /** Distinct catalog SKUs, insertion order preserved. */
  skus: string[];
  /** Set of catalog SKUs for O(1) exact-match checks. */
  exact: Set<string>;
  /** fn_sku → catalog SKUs bearing it (usable only when the list has length 1). */
  byFnSku: Map<string, string[]>;
}

export function buildCatalogSkuIndex(
  entries: CatalogSkuEntry[],
): CatalogSkuIndex {
  const skus: string[] = [];
  const exact = new Set<string>();
  const byFnSku = new Map<string, string[]>();

  for (const entry of entries) {
    const sku = entry.sku?.trim();
    if (!sku) continue;
    if (!exact.has(sku)) {
      exact.add(sku);
      skus.push(sku);
    }
    const fnSku = entry.fnSku?.trim();
    if (fnSku) {
      const list = byFnSku.get(fnSku) ?? [];
      list.push(sku);
      byFnSku.set(fnSku, list);
    }
  }

  return { skus, exact, byFnSku };
}

/**
 * Resolve a single ledger MSKU to its canonical catalog SKU, or return the raw
 * MSKU unchanged when no confident, unambiguous match exists.
 */
export function reconcileLedgerSku(
  rawSku: string,
  fnSku: string | null,
  index: CatalogSkuIndex,
): string {
  // Rule 0: already a canonical catalog SKU.
  if (index.exact.has(rawSku)) return rawSku;

  // Rule 1: FNSKU cross-reference — only when it maps to exactly one catalog SKU.
  if (fnSku) {
    const candidates = index.byFnSku.get(fnSku);
    if (candidates && candidates.length === 1) return candidates[0];
  }

  // Rule 2: unique prefix match. An empty MSKU is a prefix of everything, so
  // guard it (normalizeLedgerRows already drops empty MSKUs, this is defensive).
  if (rawSku) {
    let match: string | null = null;
    let matchCount = 0;
    for (const candidate of index.skus) {
      if (candidate.startsWith(rawSku)) {
        match = candidate;
        matchCount += 1;
        if (matchCount > 1) break;
      }
    }
    if (matchCount === 1 && match) return match;
  }

  // Rule 3: ambiguous or no match → leave the raw MSKU for "Needs review".
  return rawSku;
}

/**
 * Apply {@link reconcileLedgerSku} across rows, rewriting `sku` to the canonical
 * catalog SKU where a confident match exists. Other fields are preserved; rows
 * that don't change are returned by reference.
 */
export function reconcileVelocityRows<T extends ReconcilableRow>(
  rows: T[],
  index: CatalogSkuIndex,
): T[] {
  return rows.map((row) => {
    const canonical = reconcileLedgerSku(row.sku, row.fn_sku, index);
    return canonical === row.sku ? row : { ...row, sku: canonical };
  });
}
