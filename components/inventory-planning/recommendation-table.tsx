'use client';

import Link from 'next/link';
import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import { useFormStatus } from 'react-dom';
import { archiveSkuAction } from '@/lib/archive/actions';
import { reservedExcludingFcTransfers } from '@/lib/inventory/on-hand';
import type { RecommendationRow } from '@/lib/reorder/service';
import type { MomentumSignal } from '@/lib/analytics/service';
import { recommend } from '@/lib/reorder/recommend';
import {
  applySvdShipmentBoxCount,
  amazonSideCover,
  initialSvdShipmentBoxCounts,
  suggestedShipQty,
  svdShipmentRowKey,
  svdShipmentStorageKey,
  type SvdShipmentBoxCounts,
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
  | 'misc'
  | 'total'
  | 'perDay'
  | 'cover'
  | 'momentum'
  | 'trailing';

export type RecommendationTableVariant = 'order' | 'status' | 'legacy' | 'replenish';
type AdditionalMiscUnits = Record<string, number | ''>;

export function emailClipboardBlobs(
  html: string,
  plainText: string,
): Record<'text/html' | 'text/plain', Blob> {
  return {
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([plainText], { type: 'text/plain' }),
  };
}

type EmailDraft = Pick<HTMLDivElement, 'innerHTML' | 'innerText'>;
type EmailClipboard = Pick<Clipboard, 'write' | 'writeText'>;
type ClipboardItemConstructor = new (
  items: Record<string, Blob>,
) => ClipboardItem;

export async function copyEmailDraft(
  draft: EmailDraft,
  clipboard: EmailClipboard,
  ClipboardItemClass?: ClipboardItemConstructor,
): Promise<'rich' | 'plain'> {
  if (ClipboardItemClass && clipboard.write) {
    await clipboard.write([
      new ClipboardItemClass(
        emailClipboardBlobs(draft.innerHTML, draft.innerText),
      ),
    ]);
    return 'rich';
  }

  await clipboard.writeText(draft.innerText);
  return 'plain';
}

const EMAIL_CELL_STYLE = {
  border: '1px solid #9ca3af',
  padding: '6px 10px',
  textAlign: 'left' as const,
};

function sanitizeShipmentEmailHtml(html: string): string {
  const documentFragment = new DOMParser().parseFromString(html, 'text/html');
  const allowedTags = new Set([
    'P', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'STRONG', 'B',
    'EM', 'I', 'U', 'UL', 'OL', 'LI', 'DIV', 'SPAN',
  ]);

  for (const element of documentFragment.body.querySelectorAll('*')) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(documentFragment.createTextNode(element.textContent ?? ''));
      continue;
    }
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
  }

  return documentFragment.body.innerHTML;
}

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

export function usableSupplyWithMisc(
  row: RecommendationRow,
  additionalMiscUnits: number | '',
): number | null {
  if (row.usableSupply === null) return null;
  const misc = additionalMiscUnits === '' ? 0 : additionalMiscUnits;
  if (!Number.isInteger(misc) || misc < 0) return null;
  return row.usableSupply + misc;
}

export function orderQuantityForCoverage(
  row: RecommendationRow,
  coverageDays: number | null,
  additionalMiscUnits: number | '' = '',
): number | null {
  if (row.recommendation.status !== 'ok') return null;
  const adjustedSupply = usableSupplyWithMisc(row, additionalMiscUnits);
  if (adjustedSupply === null) return null;

  const { reasoning } = row.recommendation;
  const recalculated = recommend({
    usableSupply: adjustedSupply,
    dailyDemand: reasoning.dailyDemand,
    leadTimeDays: reasoning.leadTimeDays,
    safetyStock: reasoning.safetyStock,
    coverageDays: coverageDays ?? reasoning.coverageDays,
  });
  return recalculated.status === 'ok' ? recalculated.recommendedQty : null;
}

function statusText(row: RecommendationRow, variant: RecommendationTableVariant): string {
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

function ArchiveButton({ sku }: { sku: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={`Archive ${sku}`}
      className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-accent hover:text-foreground disabled:cursor-wait disabled:opacity-50"
    >
      {pending ? 'Archiving…' : 'Archive'}
    </button>
  );
}

/** Sum of all three FBA inbound buckets, for the display breakdown. */
function fbaIncomingTotal(row: RecommendationRow): number | null {
  const { inboundWorking, inboundShipped, inboundReceiving } = row.fbaBreakdown;
  if (inboundWorking === null || inboundShipped === null || inboundReceiving === null) {
    return null;
  }
  return (inboundWorking ?? 0) + (inboundShipped ?? 0) + (inboundReceiving ?? 0);
}

/** Sum of the non-sellable, non-incoming buckets: researching + unfulfillable. */
function fbaOtherTotal(row: RecommendationRow): number | null {
  const { researching, unfulfillable } = row.fbaBreakdown;
  if (researching === null || unfulfillable === null) return null;
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
 * On-hand (available + FC transfers), remaining reservations, incoming and
 * other stock. Transfers are removed from API reserved totals to avoid overlap.
 */
export function FbaBreakdown({ row }: { row: RecommendationRow }) {
  const counted = row.sources.fbaInbound;
  return (
    <div className="flex flex-col gap-3 text-[11px] sm:flex-row sm:gap-10">
      <div className="flex min-w-[220px] flex-col gap-1">
        <BreakdownLine label="On-hand" value={row.sources.fba} strong />
        <BreakdownLine label="Available now" value={row.fbaBreakdown.available} />
        <BreakdownLine label="FC transfer (buyable)" value={row.fbaBreakdown.fcTransfer} />
        <BreakdownLine label="Reserved (excluding FC transfer)" value={reservedExcludingFcTransfers(row.fbaBreakdown.reserved, row.fbaBreakdown.fcTransfer)} />
        <BreakdownLine label="Incoming" value={fbaIncomingTotal(row)} strong />
        <IncomingLine label="Working" value={row.fbaBreakdown.inboundWorking} />
        <IncomingLine label="Shipped" value={row.fbaBreakdown.inboundShipped} />
        <IncomingLine label="Receiving" value={row.fbaBreakdown.inboundReceiving} />
        <BreakdownLine label="Other" value={fbaOtherTotal(row)} />
      </div>
      <p className="max-w-[280px] text-muted">
        On-hand = Available now + FC transfer. Counts toward cover: On-hand
        {counted !== null ? ` + ${Math.round(counted)} incoming` : ''} + policy-counted AWD.
        Customer-order and processing reservations, and Other (researching + unfulfillable), are
        shown for context but never counted as coverage.
      </p>
    </div>
  );
}

/** Sort value for a column; null sorts last regardless of direction. */
function sortValue(
  row: RecommendationRow,
  key: SortKey,
  variant: RecommendationTableVariant,
  svdToFbaTargetDays: number,
  coverageDays: number | null,
  momentumBySku: Record<string, MomentumSignal> | undefined,
  additionalMiscUnits: AdditionalMiscUnits,
): string | number | null {
  const misc = additionalMiscUnits[svdShipmentRowKey(row)] ?? '';
  const adjustedSupply = usableSupplyWithMisc(row, misc);
  switch (key) {
    case 'sku':
      return row.sku.toLowerCase();
    case 'box':
      return row.boxName?.toLowerCase() ?? null;
    case 'fba':
      return row.sources.fba;
    case 'awd':
      return row.sources.awd;
    case 'svd':
      return row.sources.svd;
    case 'misc':
      return misc === '' ? 0 : misc;
    case 'total':
      return adjustedSupply;
    case 'perDay':
      return row.dailyDemand;
    case 'cover':
      return variant === 'replenish'
        ? amazonSideCover(row)
        : coverDays(adjustedSupply, row.dailyDemand);
    case 'momentum': {
      const signal = momentumBySku?.[row.sku];
      return signal?.absoluteChange ?? null;
    }
    case 'trailing':
      if (variant === 'order') return orderQuantityForCoverage(row, coverageDays, misc);
      if (variant === 'replenish') return suggestedShipQty(row, svdToFbaTargetDays);
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
  { key: 'fba', label: 'FBA on-hand', title: 'Available now + buyable FC transfers; expand for the breakdown', numeric: true },
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

const MISC_UNITS_COLUMN = {
  key: 'misc' as const,
  label: 'Additional misc units',
  title: 'Temporary extra units counted in total supply, cover, and suggested order',
  numeric: true,
};

const REPLENISH_COLUMNS = [
  COLUMNS[0],
  BOX_COLUMN,
  COLUMNS[1],
  COLUMNS[2],
  COLUMNS[3],
  COLUMNS[5],
  { ...COLUMNS[6], label: 'Amazon cover', title: 'Days of policy-counted FBA and AWD supply at current demand; excludes SVD' },
];

const ORDER_COLUMNS = [
  ...COLUMNS.slice(0, 4),
  MISC_UNITS_COLUMN,
  ...COLUMNS.slice(4),
].map((column) =>
  column.key === 'cover'
    ? {
        ...column,
        label: 'Total cover',
        title: 'Days of policy-eligible FBA, AWD, and SVD supply at current demand',
      }
    : column,
);

export function RecommendationTable({
  rows,
  trailingHeader,
  variant,
  svdToFbaTargetDays,
  shipmentMonthYear,
  momentumBySku,
  userId,
}: {
  rows: RecommendationRow[];
  trailingHeader: string;
  variant: RecommendationTableVariant;
  svdToFbaTargetDays?: number;
  shipmentMonthYear?: string;
  momentumBySku?: Record<string, MomentumSignal>;
  /** The current user scopes browser-only transfer-session drafts. */
  userId?: string;
}) {
  if (variant === 'replenish' && svdToFbaTargetDays === undefined) {
    throw new Error('Replenish tables require an SVD-to-FBA target.');
  }
  if (variant === 'replenish' && shipmentMonthYear === undefined) {
    throw new Error('Replenish tables require a shipment month and year.');
  }
  if (variant === 'replenish' && !userId) {
    throw new Error('Replenish tables require the current user.');
  }
  const replenishTargetDays = svdToFbaTargetDays ?? 0;
  const [coverageMonths, setCoverageMonths] = useState<number | null>(null);
  const coverageDays = coverageMonths === null ? null : coverageMonths * 30;

  // Default: biggest order first on the reorder list, else by SKU.
  const [sortKey, setSortKey] = useState<SortKey>(
    variant === 'order' || variant === 'replenish' ? 'trailing' : 'sku',
  );
  const [descending, setDescending] = useState(
    variant === 'order' || variant === 'replenish',
  );
  // Which row's FBA breakdown is expanded. One at a
  // time keeps the table compact.
  const fbaDetailId = useId();
  const [expandedFba, setExpandedFba] = useState<string | null>(null);
  // The replenish list gets two extra columns: the SVD Box name (after SKU) and
  // a free-text Notes field (far right). Notes persist only within this browser
  // session for the signed-in user, and never become shared operational data.
  const showBoxName = variant === 'replenish';
  const showNotes = variant === 'replenish';
  const showBoxesToSend = variant === 'replenish';
  const showMomentum =
    (variant === 'order' || variant === 'replenish') &&
    momentumBySku !== undefined;
  const visibleColumns =
    variant === 'replenish'
      ? REPLENISH_COLUMNS
      : variant === 'order'
        ? ORDER_COLUMNS
        : COLUMNS;
  const initialBoxCounts = initialSvdShipmentBoxCounts(
    rows,
    replenishTargetDays,
  );
  const [boxesToSend, setBoxesToSend] =
    useState<SvdShipmentBoxCounts>(initialBoxCounts);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [additionalMiscUnits, setAdditionalMiscUnits] =
    useState<AdditionalMiscUnits>({});
  const [draftHtml, setDraftHtml] = useState<string | null>(null);
  const [draftResetVersion, setDraftResetVersion] = useState(0);
  const shipmentStorageLoading = useRef(showBoxesToSend);
  const shipmentStorageKey = showBoxesToSend
    ? svdShipmentStorageKey(userId ?? '', rows, replenishTargetDays, shipmentMonthYear ?? '')
    : null;
  const emailDraftRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shipmentStorageKey) return;
    shipmentStorageLoading.current = true;
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.sessionStorage.getItem(shipmentStorageKey);
        if (!saved) return;
        const parsed = JSON.parse(saved) as {
          boxesToSend?: SvdShipmentBoxCounts;
          notes?: Record<string, string>;
          draftHtml?: string;
        };
        if (parsed.boxesToSend) setBoxesToSend(parsed.boxesToSend);
        if (parsed.notes) setNotes(parsed.notes);
        if (parsed.draftHtml && emailDraftRef.current) {
          const safeHtml = sanitizeShipmentEmailHtml(parsed.draftHtml);
          emailDraftRef.current.innerHTML = safeHtml;
          setDraftHtml(safeHtml);
        }
      } catch {
        // Session storage is a convenience. The live recommendation remains valid
        // when it is unavailable or corrupt.
      } finally {
        shipmentStorageLoading.current = false;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [shipmentStorageKey]);

  useEffect(() => {
    if (!shipmentStorageKey || shipmentStorageLoading.current) return;
    try {
      window.sessionStorage.setItem(
        shipmentStorageKey,
        JSON.stringify({ boxesToSend, notes, draftHtml }),
      );
    } catch {
      // See the read path above.
    }
  }, [boxesToSend, draftHtml, notes, shipmentStorageKey]);
  const [copyStatus, setCopyStatus] = useState('');
  // Fixed (non-Notes) columns: data + trailing + boxes-to-send when replenishing.
  const fixedColumnCount =
    visibleColumns.length +
    (showMomentum ? 1 : 0) +
    1 +
    (showBoxesToSend ? 1 : 0);
  // Where the draggable Notes column sits among the fixed columns (insert-before
  // that index). null = its default far-right position. Drag its header onto
  // another column header to move it; ephemeral, resets on reload.
  const [notesIndex, setNotesIndex] = useState<number | null>(null);
  const [draggingNotes, setDraggingNotes] = useState(false);
  const effectiveNotesIndex = notesIndex ?? fixedColumnCount;
  // Columns spanned by the expandable FBA detail row: all data columns + the
  // trailing column + Notes when shown.
  const detailColSpan = fixedColumnCount + (showNotes ? 1 : 0) + 1;

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = sortValue(
        a,
        sortKey,
        variant,
        replenishTargetDays,
        coverageDays,
        momentumBySku,
        additionalMiscUnits,
      );
      const bv = sortValue(
        b,
        sortKey,
        variant,
        replenishTargetDays,
        coverageDays,
        momentumBySku,
        additionalMiscUnits,
      );
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
  }, [
    rows,
    sortKey,
    descending,
    variant,
    replenishTargetDays,
    coverageDays,
    momentumBySku,
    additionalMiscUnits,
  ]);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setDescending((d) => !d);
      return;
    }
    setSortKey(key);
    // Numbers are most useful largest-first; text reads better A-Z.
    setDescending(key !== 'sku');
  }

  function updateBoxesToSend(rowKey: string, rawValue: string) {
    let value: number | '' = '';
    if (rawValue !== '') {
      const parsed = Number(rawValue);
      if (!Number.isInteger(parsed) || parsed < 0) return;
      value = parsed;
    }

    const next = applySvdShipmentBoxCount({
      monthYear: shipmentMonthYear ?? '',
      rows,
      currentCounts: boxesToSend,
      rowKey,
      numberOfBoxes: value,
    });
    setBoxesToSend(next.boxesToSend);
    setDraftHtml(null);
    setDraftResetVersion((version) => version + 1);
    setCopyStatus('');
  }

  function updateNote(rowKey: string, value: string) {
    setNotes((current) => ({ ...current, [rowKey]: value }));
  }

  function updateAdditionalMiscUnits(rowKey: string, rawValue: string) {
    let value: number | '' = '';
    if (rawValue !== '') {
      const parsed = Number(rawValue);
      if (!Number.isInteger(parsed) || parsed < 0) return;
      value = parsed;
    }
    setAdditionalMiscUnits((current) => ({ ...current, [rowKey]: value }));
  }

  async function copyEmail() {
    const draft = emailDraftRef.current;
    if (!draft) return;

    try {
      const result = await copyEmailDraft(
        draft,
        navigator.clipboard,
        typeof ClipboardItem === 'undefined' ? undefined : ClipboardItem,
      );
      setCopyStatus(result === 'rich' ? 'Copied' : 'Copied as plain text');
    } catch {
      setCopyStatus('Copy failed');
    }
  }

  // When the Notes column is being dragged, every fixed header is a drop target
  // that moves Notes to just before it. Gated on `draggingNotes` so an unrelated
  // drag (e.g. selecting text in a cell) can never reposition the column.
  const dropProps = (fixedIndex: number) =>
    showNotes && draggingNotes
      ? {
          onDragOver: (e: DragEvent) => e.preventDefault(),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setNotesIndex(fixedIndex);
          },
        }
      : {};

  function header(
    key: SortKey,
    label: string,
    title: string,
    numeric: boolean,
    fixedIndex?: number,
  ) {
    const active = key === sortKey;
    return (
      <th
        key={key}
        aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
        className={`whitespace-nowrap px-3 py-2 font-medium ${numeric ? 'text-right' : 'text-left'}`}
        {...(fixedIndex !== undefined ? dropProps(fixedIndex) : {})}
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
    <div className="flex flex-col gap-3">
      {variant === 'order' ? (
        <div className="flex items-center justify-end gap-2">
          <label htmlFor="reorder-coverage-months" className="text-xs text-muted">
            Months of coverage
          </label>
          <select
            id="reorder-coverage-months"
            aria-label="Months of coverage"
            value={coverageMonths ?? ''}
            onChange={(event) =>
              setCoverageMonths(
                event.currentTarget.value === ''
                  ? null
                  : Number(event.currentTarget.value),
              )
            }
            className="rounded-md border border-border bg-panel px-2 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none"
          >
            <option value="">Use SKU settings</option>
            {[1, 2, 3, 6, 12].map((months) => (
              <option key={months} value={months}>
                {months} {months === 1 ? 'month' : 'months'}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-panel border border-border bg-panel">
        <table className="w-full min-w-[960px] text-xs">
          <thead className="border-b border-border text-faint">
            <tr>
              {(() => {
                const cells = visibleColumns.map((c, i) =>
                  header(c.key, c.label, c.title, c.numeric, i),
                );
                if (showMomentum) {
                  cells.push(
                    header(
                      'momentum',
                      'Momentum',
                      'Observed recent velocity trend; opens dated evidence',
                      false,
                      visibleColumns.length,
                    ),
                  );
                }
                const trailingIndex =
                  visibleColumns.length + (showMomentum ? 1 : 0);
                cells.push(
                  header(
                    'trailing',
                    trailingHeader,
                    trailingHeader,
                    true,
                    trailingIndex,
                  ),
                );
                if (showBoxesToSend) {
                  cells.push(
                    <th
                      key="boxes-to-send"
                      className="min-w-[9rem] px-3 py-2 text-right font-medium"
                      {...dropProps(trailingIndex + 1)}
                    >
                      Number of Boxes to send
                    </th>,
                  );
                }
                if (showNotes) {
                  cells.splice(
                    effectiveNotesIndex,
                    0,
                    <th
                      key="notes"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', 'notes');
                        setDraggingNotes(true);
                      }}
                      onDragEnd={() => setDraggingNotes(false)}
                      title="Drag onto another column to move the Notes column"
                      className="cursor-grab px-3 py-2 text-left font-medium active:cursor-grabbing"
                    >
                      <span aria-hidden="true" className="mr-1 text-faint">
                        ⠿
                      </span>
                      Notes
                    </th>,
                  );
                }
                cells.push(
                  <th
                    key="archive"
                    className="px-3 py-2 text-right font-medium"
                  >
                    Archive
                  </th>,
                );
                return cells;
              })()}
            </tr>
          </thead>
          <tbody>
          {sorted.map((row) => {
            const rowKey = svdShipmentRowKey(row);
            const isExpanded = expandedFba === rowKey;
            const miscUnits = additionalMiscUnits[rowKey] ?? '';
            const adjustedSupply = usableSupplyWithMisc(row, miscUnits);
            return (
            <Fragment key={rowKey}>
            <tr className="border-b border-border/50 last:border-0">
              {(() => {
                const cells = [
                  <td
                    key="sku"
                    className="max-w-[260px] truncate px-3 py-2 font-mono text-foreground"
                    title={`${row.title} — FNSKU ${row.fnSku ?? 'unknown'}`}
                  >
                    {row.sku}
                  </td>,
                  ...(showBoxName
                    ? [
                        <td
                          key="box"
                          className="max-w-[220px] truncate px-3 py-2 text-muted"
                          title={row.boxName ?? 'no box label set'}
                        >
                          {row.boxName ?? '—'}
                        </td>,
                      ]
                    : []),
                  (
                    <td key="fba" className="px-3 py-2 text-right tabular-nums text-muted">
                      <button
                        type="button"
                        onClick={() => setExpandedFba(isExpanded ? null : rowKey)}
                        aria-expanded={isExpanded}
                        aria-controls={`${fbaDetailId}-${rowKey}`}
                        title="Show FBA on-hand and inventory breakdown"
                        aria-label={`FBA on-hand for ${row.sku}: ${num(row.sources.fba)} units. Show breakdown`}
                        className="inline-flex items-center gap-1 tabular-nums hover:text-foreground"
                      >
                        <span aria-hidden="true" className="text-[9px]">
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        {num(row.sources.fba)}
                      </button>
                    </td>
                  ),
                  <td key="awd" className="px-3 py-2 text-right tabular-nums text-muted">
                    {num(row.sources.awd)}
                  </td>,
                  <td
                    key="svd"
                    className="px-3 py-2 text-right tabular-nums text-muted"
                    title={svdCellTitle(row)}
                  >
                    {num(row.sources.svd)}
                  </td>,
                  ...(variant === 'order'
                    ? [
                        <td key="misc" className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            aria-label={`Additional misc units for ${row.sku}`}
                            placeholder="0"
                            value={miscUnits}
                            onChange={(event) =>
                              updateAdditionalMiscUnits(rowKey, event.currentTarget.value)
                            }
                            className="w-24 rounded-md border border-border bg-panel px-2 py-1 text-right text-xs tabular-nums text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
                          />
                        </td>,
                      ]
                    : []),
                  ...(variant === 'replenish'
                    ? []
                    : [
                        <td
                          key="total"
                          className="px-3 py-2 text-right tabular-nums text-foreground"
                        >
                          {num(adjustedSupply)}
                        </td>,
                      ]),
                  <td key="perDay" className="px-3 py-2 text-right tabular-nums text-muted">
                    {row.dailyDemand === null ? '—' : row.dailyDemand.toFixed(1)}
                  </td>,
                  <td key="cover" className="px-3 py-2 text-right tabular-nums text-muted">
                    {num(
                      variant === 'replenish'
                        ? amazonSideCover(row)
                        : coverDays(adjustedSupply, row.dailyDemand),
                    )}
                  </td>,
                  <td key="trailing" className="px-3 py-2 text-right">
                    {variant === 'order' || variant === 'replenish' ? (
                      <span className="text-sm font-semibold tabular-nums text-accent-strong">
                        {num(
                          variant === 'order'
                            ? orderQuantityForCoverage(row, coverageDays, miscUnits)
                            : suggestedShipQty(row, replenishTargetDays),
                        )}
                      </span>
                    ) : variant !== 'legacy' &&
                      row.recommendation.status === 'needs-review' &&
                      row.recommendation.reason === 'unknown-fba-fc-transfer' ? (
                      <Link
                        href="/catalog"
                        title="FC-transfer inventory has not been synced; on-hand is unknown"
                        className="text-[11px] text-accent underline underline-offset-2 hover:text-accent-strong"
                      >
                        Refresh FBA inventory
                      </Link>
                    ) : variant !== 'legacy' &&
                      row.recommendation.status === 'needs-review' &&
                      row.recommendation.reason === 'unknown-svd-units-per-box' ? (
                      // The one needs-review reason with a direct fix: link
                      // straight to where the box size is set.
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
                  </td>,
                ];
                if (showMomentum) {
                  const signal = momentumBySku?.[row.sku];
                  const title = signal
                    ? [
                        signal.recentStartDate && signal.recentEndDate
                          ? `Recent ${signal.recentStartDate} to ${signal.recentEndDate}`
                          : null,
                        signal.previousStartDate && signal.previousEndDate
                          ? `Previous ${signal.previousStartDate} to ${signal.previousEndDate}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join('. ')
                    : 'No observed momentum evidence yet';
                  cells.splice(
                    cells.length - 1,
                    0,
                    <td key="momentum" className="px-3 py-2">
                      <Link
                        href={`/analytics?sku=${encodeURIComponent(row.sku)}`}
                        title={title}
                        className="whitespace-nowrap text-[11px] font-medium text-accent underline-offset-2 hover:text-accent-strong hover:underline"
                      >
                        {signal?.label ?? 'Needs evidence'}
                      </Link>
                    </td>,
                  );
                }
                if (showBoxesToSend) {
                  cells.push(
                    <td key="boxes-to-send" className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        aria-label={`Number of boxes to send for ${row.sku}`}
                        value={boxesToSend[rowKey] ?? ''}
                        onChange={(event) =>
                          updateBoxesToSend(rowKey, event.currentTarget.value)
                        }
                        className="w-24 rounded-md border border-border bg-panel px-2 py-1 text-right text-xs tabular-nums text-foreground focus:border-accent focus:outline-none"
                      />
                    </td>,
                  );
                }
                if (showNotes) {
                  cells.splice(
                    effectiveNotesIndex,
                    0,
                    <td key="notes" className="px-3 py-2">
                      <input
                        type="text"
                        aria-label={`Notes for ${row.sku}`}
                        placeholder="Note…"
                        value={notes[rowKey] ?? ''}
                        onChange={(event) => updateNote(rowKey, event.currentTarget.value)}
                        className="w-full min-w-[8rem] rounded-md border border-border bg-panel px-2 py-1 text-xs text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
                      />
                    </td>,
                  );
                }
                cells.push(
                  <td key="archive" className="px-3 py-2 text-right">
                    <form action={archiveSkuAction}>
                      <input type="hidden" name="sku" value={row.sku} />
                      <ArchiveButton sku={row.sku} />
                    </form>
                  </td>,
                );
                return cells;
              })()}
            </tr>
            {isExpanded ? (
              <tr className="border-b border-border/50 bg-panel-muted/40">
                <td
                  id={`${fbaDetailId}-${rowKey}`}
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
      {showBoxesToSend ? (
        <details className="rounded-panel border border-border bg-panel p-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            Shipment email draft <span className="font-normal text-muted">(editable after opening)</span>
          </summary>
          <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Shipment email draft
              </h3>
              <p className="mt-1 text-[11px] text-faint">
                Editable and ready to copy. Changing a box count regenerates
                this draft and replaces manual edits.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span aria-live="polite" className="text-[11px] text-muted">
                {copyStatus}
              </span>
              <button
                type="button"
                onClick={copyEmail}
                className="rounded-md border border-border bg-panel px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent hover:text-accent-strong"
              >
                Copy email
              </button>
            </div>
          </div>
          <div
            key={draftResetVersion}
            ref={emailDraftRef}
            contentEditable
            suppressContentEditableWarning
            onInput={(event) =>
              setDraftHtml(sanitizeShipmentEmailHtml(event.currentTarget.innerHTML))
            }
            role="textbox"
            aria-multiline="true"
            aria-label="SVD shipment email draft"
            className="min-h-[28rem] w-full overflow-auto rounded-md border border-border bg-panel px-5 py-4 text-sm leading-relaxed text-foreground focus:border-accent focus:outline-none"
          >
            <p style={{ margin: '0 0 24px' }}>
              Subject: B&amp;E Medical {shipmentMonthYear} Shipment
            </p>
            <p style={{ margin: '0 0 16px' }}>Hi Julio,</p>
            <p style={{ margin: '0 0 16px' }}>
              See attached for box labels and pallet labels. They will be coming
              within 2 days to pick up the boxes.
            </p>
            <table
              aria-label="Shipment box counts"
              style={{ borderCollapse: 'collapse', margin: '0 0 24px' }}
            >
              <thead>
                <tr>
                  <th style={EMAIL_CELL_STYLE}>Box</th>
                  <th style={EMAIL_CELL_STYLE}>Number of Boxes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={svdShipmentRowKey(row)}>
                    <td style={EMAIL_CELL_STYLE}>
                      {row.boxName ?? '(not set)'}
                    </td>
                    <td style={EMAIL_CELL_STYLE}>
                      {boxesToSend[svdShipmentRowKey(row)] ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ margin: '0 0 24px' }}>
              As always please email or call me if you have any questions.
            </p>
            <p style={{ margin: 0 }}>
              Kind regards,
              <br />
              Brian
              <br />
              5107171898
            </p>
          </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
