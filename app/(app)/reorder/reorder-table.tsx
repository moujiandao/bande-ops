'use client';

import { useMemo, useState } from 'react';
import type { RecommendationRow } from '@/lib/reorder/service';

/**
 * Sortable reorder table.
 *
 * A client component only because sorting is interactive state; the rows are
 * assembled on the server and passed in as plain data. The trailing column is
 * selected by a serializable `variant` rather than a render prop, which cannot
 * cross the server/client boundary.
 */

type SortKey = 'sku' | 'fba' | 'awd' | 'svd' | 'total' | 'perDay' | 'cover' | 'trailing';

export type ReorderTableVariant = 'order' | 'status' | 'legacy';

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(Math.round(value));
}

function coverDays(supply: number | null, demand: number | null): number | null {
  if (supply === null || demand === null || demand <= 0) return null;
  return Math.floor(supply / demand);
}

function orderQty(row: RecommendationRow): number | null {
  return row.recommendation.status === 'ok' ? row.recommendation.recommendedQty : null;
}

function statusText(row: RecommendationRow, variant: ReorderTableVariant): string {
  if (variant === 'legacy') return 'Legacy';
  if (row.recommendation.status === 'needs-review') {
    return row.recommendation.reason.replaceAll('-', ' ');
  }
  return 'No reorder';
}

/** Sort value for a column; null sorts last regardless of direction. */
function sortValue(
  row: RecommendationRow,
  key: SortKey,
  variant: ReorderTableVariant,
): string | number | null {
  switch (key) {
    case 'sku':
      return row.sku.toLowerCase();
    case 'fba':
      return row.sources.fba;
    case 'awd':
      return row.sources.awd;
    case 'svd':
      return row.sources.svd;
    case 'total':
      return row.usableSupply;
    case 'perDay':
      return row.dailyDemand;
    case 'cover':
      return coverDays(row.usableSupply, row.dailyDemand);
    case 'trailing':
      return variant === 'order' ? orderQty(row) : statusText(row, variant);
  }
}

const COLUMNS: { key: SortKey; label: string; title: string; numeric: boolean }[] = [
  { key: 'sku', label: 'SKU', title: 'Seller SKU', numeric: false },
  { key: 'fba', label: 'FBA', title: 'Fulfillable units at FBA', numeric: true },
  { key: 'awd', label: 'AWD', title: 'Units at AWD counted as supply', numeric: true },
  { key: 'svd', label: 'SVD', title: 'Units available at SVD', numeric: true },
  { key: 'total', label: 'Total', title: 'Total usable supply', numeric: true },
  { key: 'perDay', label: 'Per day', title: 'Units sold per day', numeric: true },
  { key: 'cover', label: 'Cover', title: 'Days of supply at current demand', numeric: true },
];

export function ReorderTable({
  rows,
  trailingHeader,
  variant,
}: {
  rows: RecommendationRow[];
  trailingHeader: string;
  variant: ReorderTableVariant;
}) {
  // Default: biggest order first on the reorder list, else by SKU.
  const [sortKey, setSortKey] = useState<SortKey>(
    variant === 'order' ? 'trailing' : 'sku',
  );
  const [descending, setDescending] = useState(variant === 'order');

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sortKey, variant);
      const bv = sortValue(b, sortKey, variant);
      // Unknown values always sink, so sorting never buries real data under
      // a wall of em dashes.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return descending ? -cmp : cmp;
    });
  }, [rows, sortKey, descending, variant]);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setDescending((d) => !d);
      return;
    }
    setSortKey(key);
    // Numbers are most useful largest-first; text reads better A-Z.
    setDescending(key !== 'sku');
  }

  function header(key: SortKey, label: string, title: string, numeric: boolean) {
    const active = key === sortKey;
    return (
      <th
        key={key}
        aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
        className={`px-3 py-2 font-medium ${numeric ? 'text-right' : 'text-left'}`}
      >
        <button
          type="button"
          onClick={() => toggle(key)}
          title={title}
          className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
            active ? 'text-foreground' : ''
          }`}
        >
          {label}
          <span aria-hidden="true" className="text-[9px]">
            {active ? (descending ? '▼' : '▲') : '↕'}
          </span>
        </button>
      </th>
    );
  }

  return (
    <div className="overflow-x-auto rounded-panel border border-border bg-panel">
      <table className="w-full min-w-[720px] text-xs">
        <thead className="border-b border-border text-faint">
          <tr>
            {COLUMNS.map((c) => header(c.key, c.label, c.title, c.numeric))}
            {header('trailing', trailingHeader, trailingHeader, true)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={`${row.marketplaceId}:${row.sku}`}
              className="border-b border-border/50 last:border-0"
            >
              <td
                className="max-w-[260px] truncate px-3 py-2 font-mono text-foreground"
                title={`${row.title} — FNSKU ${row.fnSku ?? 'unknown'}`}
              >
                {row.sku}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">
                {num(row.sources.fba)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">
                {num(row.sources.awd)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">
                {num(row.sources.svd)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">
                {num(row.usableSupply)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">
                {row.dailyDemand === null ? '—' : row.dailyDemand.toFixed(1)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">
                {num(coverDays(row.usableSupply, row.dailyDemand))}
              </td>
              <td className="px-3 py-2 text-right">
                {variant === 'order' ? (
                  <span className="text-sm font-semibold tabular-nums text-accent-strong">
                    {num(orderQty(row))}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted">
                    {statusText(row, variant)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
