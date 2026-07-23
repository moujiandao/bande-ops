import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { assembleRecommendations, type RecommendationRow } from '@/lib/reorder/service';
import { refreshSvdInventoryAction } from '@/lib/svd/actions';
import { createClient } from '@/lib/supabase/server';

function reorderQty(row: RecommendationRow): number {
  return row.recommendation.status === 'ok' ? row.recommendation.recommendedQty : 0;
}


const refreshButtonClass =
  'rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-panel-muted';



function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}



/** Compact number, or an em dash when the value is UNKNOWN (never 0). */
function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(Math.round(value));
}

/**
 * How many days the usable supply covers at current demand. The single most
 * useful derived figure on this page: it puts every SKU on one scale
 * regardless of size or velocity. Unknown demand yields no answer rather than
 * a misleading Infinity.
 */
function daysOfCover(supply: number | null, demand: number | null): string {
  if (supply === null || demand === null || demand <= 0) return '—';
  return String(Math.floor(supply / demand));
}

/** Shared column set for every reorder list. */
function RowTable({
  rows,
  trailingHeader,
  trailing,
}: {
  rows: RecommendationRow[];
  trailingHeader: string;
  trailing: (row: RecommendationRow) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-panel border border-border bg-panel">
      <table className="w-full min-w-[720px] text-xs">
        <thead className="border-b border-border text-faint">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">SKU</th>
            <th className="px-3 py-2 text-right font-medium" title="Fulfillable units at FBA">FBA</th>
            <th className="px-3 py-2 text-right font-medium" title="Units at AWD counted as supply">AWD</th>
            <th className="px-3 py-2 text-right font-medium" title="Units available at SVD">SVD</th>
            <th className="px-3 py-2 text-right font-medium" title="Total usable supply across all sources">Total</th>
            <th className="px-3 py-2 text-right font-medium" title="Units sold per day (90 in-stock days)">Per day</th>
            <th className="px-3 py-2 text-right font-medium" title="Days the total supply covers at current demand">Cover</th>
            <th className="px-3 py-2 text-right font-medium">{trailingHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            return (
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
                  {daysOfCover(row.usableSupply, row.dailyDemand)}
                </td>
                <td className="px-3 py-2 text-right">{trailing(row)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReorderPage() {
  const supabase = await createClient();
  const { rows, errors, sourceHealth } = await assembleRecommendations({ supabase });

  // Legacy SKUs are excluded from every working list. They stay reachable in a
  // collapsed section so an excluded SKU is never silently invisible.
  const legacy = rows.filter((row) => row.isLegacy);
  const active = rows.filter((row) => !row.isLegacy);

  const toReorder = active
    .filter((row) => row.recommendation.status === 'ok' && reorderQty(row) > 0)
    .sort((a, b) => reorderQty(b) - reorderQty(a));
  const wellStocked = active.filter(
    (row) => row.recommendation.status === 'ok' && reorderQty(row) === 0,
  );
  const needsReview = active.filter(
    (row) => row.recommendation.status === 'needs-review',
  );

  const loadErrors = Object.entries(errors).filter(([, message]) => Boolean(message));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Reorder recommendations
          </h1>
          <p className="max-w-prose text-sm text-muted">
            Recommended order quantities from FBA, AWD, SVD, sales velocity,
            lead time, and safety stock. Decision support only, nothing here
            writes back to Amazon.
          </p>
        </div>
        <form action={refreshSvdInventoryAction}>
          <button type="submit" className={refreshButtonClass}>
            Refresh SVD
          </button>
        </form>
      </header>

      {sourceHealth.length > 0 ? (
        <section className="grid gap-2 md:grid-cols-3">
          {sourceHealth.map((source) => (
            <div
              key={source.source}
              className="rounded-panel border border-border bg-panel p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-faint">
                  {source.source.replaceAll('_', ' ')}
                </span>
                <Badge
                  className={
                    source.status === 'success'
                      ? 'border-accent-soft bg-accent-soft text-accent-strong'
                      : 'border-border bg-panel-muted text-muted'
                  }
                >
                  {source.status}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted">
                {source.lastSuccessAt ? (
                  <>
                    Last refreshed{' '}
                    <time dateTime={source.lastSuccessAt}>
                      {formatTimestamp(source.lastSuccessAt)}
                    </time>
                  </>
                ) : (
                  'Never refreshed'
                )}
                {source.rowCount === null ? '' : ` · ${source.rowCount} rows`}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      {loadErrors.length > 0 ? (
        <div className="rounded-panel border border-border bg-panel-muted p-3 text-xs text-foreground">
          ⚠ A source failed to load:{' '}
          {loadErrors.map(([name, message]) => `${name}: ${message}`).join('; ')}.
          Some rows may read &ldquo;Needs review&rdquo; because of this load error.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-panel border border-dashed border-border bg-panel p-8">
          <h2 className="text-sm font-medium text-foreground">
            Nothing to recommend yet
          </h2>
          <p className="max-w-prose text-sm text-muted">
            No catalog SKUs found. Sync Amazon catalog, FBA inventory, AWD
            inventory, sales velocity, and SVD inventory first.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Reorder now</h2>
              <Badge variant="accent">{toReorder.length}</Badge>
            </div>
            {toReorder.length === 0 ? (
              <p className="rounded-panel border border-dashed border-border bg-panel p-4 text-xs text-muted">
                No SKUs are at or below their reorder point.
              </p>
            ) : (
              <RowTable
                rows={toReorder}
                trailingHeader="Order"
                trailing={(row) => (
                  <span className="text-sm font-semibold tabular-nums text-accent-strong">
                    {row.recommendation.status === 'ok'
                      ? row.recommendation.recommendedQty
                      : '—'}
                  </span>
                )}
              />
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Needs review</h2>
              <Badge className="border-border bg-panel-muted text-muted">
                {needsReview.length}
              </Badge>
            </div>
            {needsReview.length === 0 ? (
              <p className="rounded-panel border border-dashed border-border bg-panel p-4 text-xs text-muted">
                Every SKU has usable supply, SVD mapping, and velocity.
              </p>
            ) : (
              <RowTable
                rows={needsReview}
                trailingHeader="Status"
                trailing={(row) => (
                  <span
                    className="text-[11px] text-muted"
                    title={
                      row.recommendation.status === 'needs-review'
                        ? row.recommendation.reason
                        : undefined
                    }
                  >
                    {row.recommendation.status === 'needs-review'
                      ? row.recommendation.reason.replaceAll('-', ' ')
                      : 'Needs review'}
                  </span>
                )}
              />
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Well stocked</h2>
              <Badge className="border-border bg-panel-muted text-muted">
                {wellStocked.length}
              </Badge>
            </div>
            {wellStocked.length === 0 ? (
              <p className="rounded-panel border border-dashed border-border bg-panel p-4 text-xs text-muted">
                No SKUs are above their reorder point yet.
              </p>
            ) : (
              <RowTable
                rows={wellStocked}
                trailingHeader="Status"
                trailing={() => (
                  <span className="text-[11px] text-muted">No reorder</span>
                )}
              />
            )}
          </section>
        </div>
      )}

      {legacy.length > 0 ? (
        <details className="rounded-panel border border-border bg-panel p-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            Legacy{' '}
            <span className="font-normal text-muted">
              ({legacy.length} SKUs with no sales in ~18 months)
            </span>
          </summary>
          <p className="mt-2 text-xs text-muted">
            Excluded from the lists above. A listing created in the last 12
            months is never treated as legacy, and a SKU with no known listing
            date is left in the lists rather than hidden.
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {legacy.map((row) => (
              <li
                key={`${row.marketplaceId}:${row.sku}`}
                className="truncate font-mono text-xs text-muted"
                title={`${row.title} — FNSKU ${row.fnSku ?? 'unknown'}`}
              >
                {row.sku}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
