'use client';

import { useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { formatInventoryLevel } from '@/lib/inventory/format';
import {
  searchRows,
  sortByInventory,
  type SortDirection,
} from '@/lib/catalog/view';
import { upsertSkuNote } from '@/lib/notes/notes-actions';

/**
 * Client-side catalog table: search + sort-by-inventory over the server-fetched
 * rows, plus an inline per-SKU note editor.
 *
 * The parent server component does all the data fetching (catalog + inventory +
 * notes mirrors) and hands the already-joined rows down as props; this component
 * owns only ephemeral view state (query string, sort direction) and the
 * optimistic note-edit interaction. Filtering/sorting run in memory via the pure
 * helpers in lib/catalog/view, so the UNKNOWN-stock invariant (null never sorts
 * as 0) lives in one tested place rather than here.
 */

export type CatalogTableRow = {
  marketplace_id: string;
  sku: string;
  asin: string;
  title: string;
  image_url: string | null;
  total_quantity: number | null;
  note: string;
};

type SortMode = 'default' | SortDirection;

export function CatalogTable({ rows }: { rows: CatalogTableRow[] }) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('default');

  const visibleRows = useMemo(() => {
    const filtered = searchRows(rows, query);
    if (sortMode === 'default') return filtered;
    return sortByInventory(filtered, sortMode);
  }, [rows, query, sortMode]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sku, asin, or title…"
          aria-label="Search catalog by sku, asin, or title"
          className="w-64 rounded-md border border-border bg-panel px-3 py-1.5 text-sm text-foreground placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <label className="flex items-center gap-2 text-xs text-muted">
          <span>Sort</span>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            aria-label="Sort by inventory"
            className="rounded-md border border-border bg-panel px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="default">SKU (default)</option>
            <option value="asc">Inventory: lowest first</option>
            <option value="desc">Inventory: highest first</option>
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-panel border border-border bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-faint">
              <th className="w-16 px-4 py-3 font-medium">Image</th>
              <th className="px-4 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">ASIN</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 text-right font-medium">Inventory</th>
              <th className="px-4 py-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-muted"
                >
                  No items match &ldquo;{query}&rdquo;.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                // null OR a missing inventory row -> UNKNOWN (distinct from 0).
                const level = formatInventoryLevel(row.total_quantity);
                return (
                  <tr
                    key={`${row.marketplace_id}:${row.sku}`}
                    className="border-b border-border last:border-b-0 align-top"
                  >
                    <td className="px-4 py-3">
                      {row.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.image_url}
                          alt={row.title}
                          className="h-10 w-10 rounded-md border border-border object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-faint"
                        >
                          N/A
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {row.sku}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {row.asin}
                    </td>
                    <td className="px-4 py-3 text-foreground">{row.title}</td>
                    <td className="px-4 py-3 text-right">
                      {level.isUnknown ? (
                        // UNKNOWN (null / no row): a muted badge, visually
                        // distinct from a numeric 0. Never rendered as "0".
                        <span title="Amazon did not report a quantity - flagged for review">
                          <Badge variant="soon">{level.label}</Badge>
                        </span>
                      ) : (
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {level.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <NoteCell
                        marketplaceId={row.marketplace_id}
                        sku={row.sku}
                        initialNote={row.note}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <span className="text-[11px] text-faint">
            {visibleRows.length} of {rows.length} item
            {rows.length === 1 ? '' : 's'}
          </span>
          <Badge className="border-border bg-panel-muted text-muted">US</Badge>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline editor for one SKU's note. Holds the draft locally and persists via the
 * upsertSkuNote server action (RLS-governed, authenticated write path). The
 * action revalidates /catalog, but we also track a local "saved" flash so the
 * operator gets immediate feedback without waiting for the refetch.
 */
function NoteCell({
  marketplaceId,
  sku,
  initialNote,
}: {
  marketplaceId: string;
  sku: string;
  initialNote: string;
}) {
  const [draft, setDraft] = useState(initialNote);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dirty = draft !== initialNote;

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await upsertSkuNote(marketplaceId, sku, draft);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed');
      }
    });
  }

  return (
    <form
      action={save}
      className="flex items-start gap-2"
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder="Add a note…"
        aria-label={`Note for ${sku}`}
        className="min-h-[2.25rem] w-56 resize-y rounded-md border border-border bg-panel px-2 py-1 text-xs text-foreground placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="flex flex-col items-start gap-1">
        <button
          type="submit"
          disabled={isPending || !dirty}
          className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-panel-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        {error ? (
          <span className="text-[10px] text-red-500">{error}</span>
        ) : dirty ? (
          <span className="text-[10px] text-faint">Unsaved</span>
        ) : null}
      </div>
    </form>
  );
}
