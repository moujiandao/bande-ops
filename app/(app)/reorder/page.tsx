import { Badge } from '@/components/ui/badge';
import { assembleRecommendations, type RecommendationRow } from '@/lib/reorder/service';
import { refreshSvdInventoryAction } from '@/lib/svd/actions';
import { createClient } from '@/lib/supabase/server';

function reorderQty(row: RecommendationRow): number {
  return row.recommendation.status === 'ok' ? row.recommendation.recommendedQty : 0;
}

const REVIEW_REASON_LABELS: Record<string, string> = {
  'unknown-usable-supply': 'Usable supply is Unknown',
  'missing-fba-inventory': 'Missing FBA inventory snapshot',
  'unknown-fba-fulfillable': 'FBA fulfillable quantity is Unknown',
  'unknown-fba-inbound-working': 'FBA inbound working quantity is Unknown',
  'unknown-fba-inbound-shipped': 'FBA inbound shipped quantity is Unknown',
  'unknown-fba-inbound-receiving': 'FBA inbound receiving quantity is Unknown',
  'unknown-awd-replenishment': 'AWD replenishment inventory is Unknown',
  'unknown-svd-inventory': 'SVD inventory is Unknown',
  'missing-svd-mapping': 'No SVD mapping found',
  'unknown-demand': 'Sales velocity is Unknown',
  'invalid-usable-supply': 'Usable supply value is invalid',
  'invalid-demand': 'Sales velocity value is invalid',
  'invalid-lead-time': 'Lead time is invalid',
  'invalid-safety-stock': 'Safety stock is invalid',
};

const refreshButtonClass =
  'rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-panel-muted';

function fmtNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmtMaybeNumber(n: number | null): string {
  return n === null ? 'Unknown' : fmtNumber(n);
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function reasonLabel(row: RecommendationRow): string {
  if (row.recommendation.status !== 'needs-review') return '';
  if (row.recommendation.reason.startsWith('stale-source-')) {
    const source = row.recommendation.reason
      .replace('stale-source-', '')
      .replaceAll('_', ' ');
    return `Refresh needed: ${source} is not fresh`;
  }
  return REVIEW_REASON_LABELS[row.recommendation.reason] ?? row.recommendation.reason;
}

function RowFacts({ row }: { row: RecommendationRow }) {
  const rec = row.recommendation;
  const sample =
    row.velocitySampleDays === null ? '' : ` · sample ${row.velocitySampleDays} in-stock days`;

  if (rec.status === 'ok') {
    const r = rec.reasoning;
    return (
      <span className="text-xs text-faint">
        usable supply {fmtNumber(r.usableSupply)} · velocity{' '}
        {fmtNumber(r.dailyDemand)}/day{sample} · lead {r.leadTimeDays}d · safety{' '}
        {r.safetyStock} · reorder point {fmtNumber(r.reorderPoint)}
      </span>
    );
  }

  return (
    <span className="text-xs text-faint">
      {reasonLabel(row)} · usable supply {fmtMaybeNumber(row.usableSupply)} · velocity{' '}
      {fmtMaybeNumber(row.dailyDemand)}/day{sample}
    </span>
  );
}

export default async function ReorderPage() {
  const supabase = await createClient();
  const { rows, errors, sourceHealth } = await assembleRecommendations({ supabase });

  const toReorder = rows
    .filter((row) => row.recommendation.status === 'ok' && reorderQty(row) > 0)
    .sort((a, b) => reorderQty(b) - reorderQty(a));
  const wellStocked = rows.filter(
    (row) => row.recommendation.status === 'ok' && reorderQty(row) === 0,
  );
  const needsReview = rows.filter((row) => row.recommendation.status === 'needs-review');

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
              <ul className="flex flex-col gap-3">
                {toReorder.map((row) => {
                  const rec = row.recommendation;
                  if (rec.status !== 'ok') return null;
                  return (
                    <li
                      key={`${row.marketplaceId}:${row.sku}`}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-accent-soft bg-panel p-4"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-sm font-medium text-foreground">
                          {row.title}
                        </span>
                        <span className="truncate font-mono text-xs text-muted">
                          {row.sku}
                        </span>
                        <RowFacts row={row} />
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-2xl font-semibold tabular-nums text-accent-strong">
                          {rec.recommendedQty}
                        </span>
                        <span className="text-[11px] uppercase tracking-wide text-faint">
                          units to order
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
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
              <ul className="flex flex-col gap-2">
                {needsReview.map((row) => (
                  <li
                    key={`${row.marketplaceId}:${row.sku}`}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-border bg-panel p-4"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-sm font-medium text-foreground">
                        {row.title}
                      </span>
                      <span className="truncate font-mono text-xs text-muted">
                        {row.sku}
                      </span>
                      <RowFacts row={row} />
                    </div>
                    <Badge className="border-border bg-panel-muted text-muted">
                      Needs review
                    </Badge>
                  </li>
                ))}
              </ul>
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
              <ul className="flex flex-col gap-2">
                {wellStocked.map((row) => (
                  <li
                    key={`${row.marketplaceId}:${row.sku}`}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-border bg-panel p-4"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-sm font-medium text-foreground">
                        {row.title}
                      </span>
                      <span className="truncate font-mono text-xs text-muted">
                        {row.sku}
                      </span>
                      <RowFacts row={row} />
                    </div>
                    <span className="text-xs font-medium text-muted">No reorder</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
