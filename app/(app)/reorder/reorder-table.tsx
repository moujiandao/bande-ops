'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import type { RecommendationRow } from '@/lib/reorder/service';
import {
  amazonSideCover,
  REPLENISH_TARGET_DAYS,
  suggestedShipQty,
} from '@/lib/reorder/replenish';

/**
 * Sortable reorder table.
 *
 * A client component only because sorting is interactive state; the rows are
 * assembled on the server and passed in as plain data. The trailing column is
 * selected by a serializable `variant` rather than a render prop, which cannot
 * cross the server/client boundary.
 */

type SortKey =
  | 'sku'
  | 'box'
  | 'fba'
  | 'awd'
  | 'svd'
  | 'total'
  | 'perDay'
  | 'cover'
  | 'trailing';

export type ReorderTableVariant = 'order' | 'status' | 'legacy' | 'replenish';

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(Math.round(value));
}

/**
 * The SVD column shows UNITS, but SVD reports boxes. This tooltip exposes the
 * derivation so the number is auditable, and names the reason when it is blank.
 */
function svdCellTitle(row: RecommendationRow): string {
  if (row.svdBoxes === null) return 'SVD quantity unavailable';
  if (row.svdBoxes === 0) return 'Not carried at SVD';
  if (row.svdUnitsPerBox === null) {
    return `${row.svdBoxes} boxes — set units per box in Settings to convert to units`;
  }
  // Read the already-converted figure rather than multiplying again: the
  // conversion lives in one place (lib/reorder), and this cell must not become a
  // second site that could silently diverge if that math ever changes.
  const units = row.sources.svd;
  if (units === null) return `${row.svdBoxes} boxes`;
  return `${units} units — ${row.svdBoxes} boxes × ${row.svdUnitsPerBox}`;
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

/**
 * Seller Central inbound shipments queue. Amazon exposes no reliable per-SKU or
 * per-shipment deep link, so every incoming line points at the queue. Swap this
 * one constant if a better URL exists.
 */
const SELLER_CENTRAL_INBOUND_URL =
  'https://sellercentral.amazon.com/fba/inbound-shipment-queue';

/**
 * The full FBA count for the replenish display: Available + Reserved + all
 * Incoming + Other. Null (shown as an em dash) only when there is no FBA data
 * at all; a present row with some unknown buckets still sums what is known.
 */
function fbaDisplayTotal(row: RecommendationRow): number | null {
  const b = row.fbaBreakdown;
  const parts = [
    b.available,
    b.reserved,
    b.inboundWorking,
    b.inboundShipped,
    b.inboundReceiving,
    b.researching,
    b.unfulfillable,
  ];
  if (parts.every((v) => v === null)) return null;
  return parts.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

/** Sum of all three FBA inbound buckets, for the display breakdown. */
function fbaIncomingTotal(row: RecommendationRow): number | null {
  const { inboundWorking, inboundShipped, inboundReceiving } = row.fbaBreakdown;
  if (inboundWorking === null && inboundShipped === null && inboundReceiving === null) {
    return null;
  }
  return (inboundWorking ?? 0) + (inboundShipped ?? 0) + (inboundReceiving ?? 0);
}

/** Sum of the non-sellable, non-incoming buckets: researching + unfulfillable. */
function fbaOtherTotal(row: RecommendationRow): number | null {
  const { researching, unfulfillable } = row.fbaBreakdown;
  if (researching === null && unfulfillable === null) return null;
  return (researching ?? 0) + (unfulfillable ?? 0);
}

/** One incoming bucket line, linking to the Seller Central inbound queue. */
function IncomingLine({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between gap-4 pl-3">
      <a
        href={SELLER_CENTRAL_INBOUND_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline underline-offset-2 hover:text-accent-strong"
      >
        {label}
      </a>
      <span className="tabular-nums text-muted">{num(value)}</span>
    </div>
  );
}

/** One top-level breakdown line. */
function BreakdownLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={strong ? 'font-medium text-foreground' : 'text-muted'}>
        {label}
      </span>
      <span
        className={`tabular-nums ${strong ? 'text-foreground' : 'text-muted'}`}
      >
        {num(value)}
      </span>
    </div>
  );
}

/**
 * The full FBA picture for a row, shown when its FBA cell is expanded. Groups:
 * Available + Reserved + Incoming (working/shipped/receiving) + Other. Marks
 * which parts actually feed the replenish recommendation.
 */
function FbaBreakdown({ row }: { row: RecommendationRow }) {
  const counted = row.sources.fbaInbound;
  return (
    <div className="flex flex-col gap-3 text-[11px] sm:flex-row sm:gap-10">
      <div className="flex min-w-[220px] flex-col gap-1">
        <BreakdownLine label="Available" value={row.sources.fba} strong />
        <BreakdownLine label="Reserved" value={row.fbaBreakdown.reserved} />
        <BreakdownLine label="Incoming" value={fbaIncomingTotal(row)} strong />
        <IncomingLine label="Working" value={row.fbaBreakdown.inboundWorking} />
        <IncomingLine label="Shipped" value={row.fbaBreakdown.inboundShipped} />
        <IncomingLine label="Receiving" value={row.fbaBreakdown.inboundReceiving} />
        <BreakdownLine label="Other" value={fbaOtherTotal(row)} />
      </div>
      <p className="max-w-[280px] text-muted">
        Counts toward cover: Available
        {counted !== null ? ` + ${Math.round(counted)} incoming` : ''} + AWD.
        Reserved (held for orders) and Other (researching + unfulfillable) are
        shown for context but never counted as coverage.
      </p>
    </div>
  );
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
    case 'box':
      return row.boxName?.toLowerCase() ?? null;
    case 'fba':
      // The replenish FBA cell shows the full FBA total, so sort by that; every
      // other list shows fulfillable and sorts by it.
      return variant === 'replenish' ? fbaDisplayTotal(row) : row.sources.fba;
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
      if (variant === 'order') return orderQty(row);
      if (variant === 'replenish') return suggestedShipQty(row, REPLENISH_TARGET_DAYS);
      return statusText(row, variant);
  }
}

const BOX_COLUMN = {
  key: 'box' as const,
  label: 'Box',
  title: 'Operator box label for this SKU (set in Settings)',
  numeric: false,
};

const COLUMNS: { key: SortKey; label: string; title: string; numeric: boolean }[] = [
  { key: 'sku', label: 'SKU', title: 'Seller SKU', numeric: false },
  { key: 'fba', label: 'FBA', title: 'Fulfillable units at FBA', numeric: true },
  { key: 'awd', label: 'AWD', title: 'Units at AWD counted as supply', numeric: true },
  {
    key: 'svd',
    label: 'SVD',
    title: 'Units available at SVD (converted from boxes; hover a cell for the math)',
    numeric: true,
  },
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
    variant === 'order' || variant === 'replenish' ? 'trailing' : 'sku',
  );
  const [descending, setDescending] = useState(
    variant === 'order' || variant === 'replenish',
  );
  // Which row's FBA breakdown is expanded (replenish variant only). One at a
  // time keeps the table compact.
  const [expandedFba, setExpandedFba] = useState<string | null>(null);
  const showFbaBreakdown = variant === 'replenish';
  // The replenish list gets two extra columns: the SVD Box name (after SKU) and
  // a free-text Notes field (far right). Notes are intentionally NOT persisted —
  // they are scratch space for a picking session and reset on reload.
  const showBoxName = variant === 'replenish';
  const showNotes = variant === 'replenish';
  const visibleColumns = showBoxName
    ? [COLUMNS[0], BOX_COLUMN, ...COLUMNS.slice(1)]
    : COLUMNS;
  // Columns spanned by the expandable FBA detail row: all data columns + the
  // trailing column + Notes when shown.
  const detailColSpan = visibleColumns.length + 1 + (showNotes ? 1 : 0);

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
            {visibleColumns.map((c) => header(c.key, c.label, c.title, c.numeric))}
            {header('trailing', trailingHeader, trailingHeader, true)}
            {showNotes ? (
              <th className="px-3 py-2 text-left font-medium">Notes</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const rowKey = `${row.marketplaceId}:${row.sku}`;
            const isExpanded = expandedFba === rowKey;
            return (
            <Fragment key={rowKey}>
            <tr className="border-b border-border/50 last:border-0">
              <td
                className="max-w-[260px] truncate px-3 py-2 font-mono text-foreground"
                title={`${row.title} — FNSKU ${row.fnSku ?? 'unknown'}`}
              >
                {row.sku}
              </td>
              {showBoxName ? (
                <td
                  className="max-w-[220px] truncate px-3 py-2 text-muted"
                  title={row.boxName ?? 'no box label set'}
                >
                  {row.boxName ?? '—'}
                </td>
              ) : null}
              {showFbaBreakdown ? (
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  <button
                    type="button"
                    onClick={() => setExpandedFba(isExpanded ? null : rowKey)}
                    aria-expanded={isExpanded}
                    aria-controls={`fba-detail-${rowKey}`}
                    title="Show the full FBA breakdown"
                    className="inline-flex items-center gap-1 tabular-nums hover:text-foreground"
                  >
                    <span aria-hidden="true" className="text-[9px]">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    {num(fbaDisplayTotal(row))}
                  </button>
                </td>
              ) : (
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {num(row.sources.fba)}
                </td>
              )}
              <td className="px-3 py-2 text-right tabular-nums text-muted">
                {num(row.sources.awd)}
              </td>
              <td
                className="px-3 py-2 text-right tabular-nums text-muted"
                title={svdCellTitle(row)}
              >
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
                {variant === 'order' || variant === 'replenish' ? (
                  <span className="text-sm font-semibold tabular-nums text-accent-strong">
                    {num(
                      variant === 'order'
                        ? orderQty(row)
                        : suggestedShipQty(row, REPLENISH_TARGET_DAYS),
                    )}
                  </span>
                ) : variant !== 'legacy' &&
                  row.recommendation.status === 'needs-review' &&
                  row.recommendation.reason === 'unknown-svd-units-per-box' ? (
                  // The one needs-review reason with a direct fix: link straight
                  // to where the box size is set, per the design spec.
                  <Link
                    href="/settings"
                    className="text-[11px] text-accent underline underline-offset-2 hover:text-accent-strong"
                  >
                    set SVD box size
                  </Link>
                ) : (
                  <span className="text-[11px] text-muted">
                    {statusText(row, variant)}
                  </span>
                )}
              </td>
              {showNotes ? (
                <td className="px-3 py-2">
                  <input
                    type="text"
                    aria-label={`Notes for ${row.sku} (not saved)`}
                    placeholder="Note…"
                    // Uncontrolled and unpersisted on purpose: scratch space for a
                    // picking session. React keeps the value across re-sorts via the
                    // row's stable key; it clears on reload.
                    className="w-full min-w-[8rem] rounded-md border border-border bg-panel px-2 py-1 text-xs text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
                  />
                </td>
              ) : null}
            </tr>
            {showFbaBreakdown && isExpanded ? (
              <tr className="border-b border-border/50 bg-panel-muted/40">
                <td
                  id={`fba-detail-${rowKey}`}
                  colSpan={detailColSpan}
                  className="px-3 py-3"
                >
                  <FbaBreakdown row={row} />
                </td>
              </tr>
            ) : null}
            </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
