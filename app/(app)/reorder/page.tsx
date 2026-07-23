import { Badge } from '@/components/ui/badge';
import { ReorderTable } from './reorder-table';
import {
  amazonSideCover,
  suggestedShipQty,
  REPLENISH_TARGET_DAYS,
} from '@/lib/reorder/replenish';
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



export default async function ReorderPage() {
  const supabase = await createClient();
  const { rows, errors, sourceHealth } = await assembleRecommendations({ supabase });

  // Legacy SKUs are excluded from every working list. They stay reachable in a
  // collapsed section so an excluded SKU is never silently invisible.
  const legacy = rows.filter((row) => row.isLegacy);
  const active = rows.filter((row) => !row.isLegacy);

  // Stock sitting at SVD that FBA needs now. Coverage here counts only what is
  // already at or heading to Amazon (FBA + AWD) — including SVD would mask the
  // very SKUs that need shipping, since their stock is what we are looking at.
  const replenishFromSvd = active.filter((row) => {
    const cover = amazonSideCover(row);
    return (
      cover !== null &&
      cover < REPLENISH_TARGET_DAYS &&
      suggestedShipQty(row, REPLENISH_TARGET_DAYS) !== null
    );
  });

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
          {replenishFromSvd.length > 0 ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">
                  Replenish from SVD to FBA
                </h2>
                <Badge variant="accent">{replenishFromSvd.length}</Badge>
              </div>
              <p className="max-w-prose text-xs text-muted">
                Under {REPLENISH_TARGET_DAYS} days of cover from stock already at
                or heading to Amazon (FBA + AWD), with units available at SVD.
                The quantity is what it takes to reach {REPLENISH_TARGET_DAYS}{' '}
                days, capped at what SVD actually holds — no supplier order
                needed.
              </p>
              <ReorderTable
                rows={replenishFromSvd}
                trailingHeader="Ship"
                variant="replenish"
              />
            </section>
          ) : null}

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
              <ReorderTable rows={toReorder} trailingHeader="Order" variant="order" />
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
              <ReorderTable rows={needsReview} trailingHeader="Status" variant="status" />
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
              <ReorderTable rows={wellStocked} trailingHeader="Status" variant="status" />
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
          <div className="mt-3">
            <ReorderTable rows={legacy} trailingHeader="Status" variant="legacy" />
          </div>
        </details>
      ) : null}
    </div>
  );
}
