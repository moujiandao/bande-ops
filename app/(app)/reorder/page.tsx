import Link from 'next/link';
import { AnalyticsBasisNote } from '@/components/analytics/basis-note';
import { Badge } from '@/components/ui/badge';
import { SourceStatus } from '@/components/replenishment/source-status';
import { WorkflowSwitch } from '@/components/replenishment/workflow-switch';
import { RefreshSvdButton } from '@/components/replenishment/refresh-svd-button';
import { loadReorderWorkflowData } from '@/lib/reorder/workflow-data';
import { RecommendationTable } from '@/components/inventory-planning/recommendation-table';

export default async function ReorderPage() {
  const data = await loadReorderWorkflowData();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Supplier purchasing</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Supplier Reorder</h1>
          <p className="max-w-prose text-sm text-muted">
            Plan purchases using stock across FBA, AWD, and SVD. These recommendations are decision support only and never place an order.
          </p>
        </div>
        <RefreshSvdButton />
      </header>

      <WorkflowSwitch current="reorder" />

      <AnalyticsBasisNote settings={data.analyticsSettings} />

      <SourceStatus sourceHealth={data.sourceHealth} loadErrors={data.loadErrors} />

      {data.archiveError ? (
        <div className="rounded-panel border border-border bg-panel-muted p-3 text-xs text-foreground">
          Archived products could not be loaded ({data.archiveError}). Product lists are hidden so archived SKUs cannot reappear accidentally.
        </div>
      ) : null}

      {data.analyticsError ? (
        <div className="rounded-panel border border-border bg-panel-muted p-3 text-xs text-foreground">
          Sales momentum is unavailable ({data.analyticsError}). Reorder math is unchanged.
        </div>
      ) : data.trendingCount > 0 ? (
        <Link
          href="/analytics?filter=trending"
          className="self-start text-xs font-medium text-accent underline underline-offset-2 hover:text-accent-strong"
        >
          {data.trendingCount} reorder {data.trendingCount === 1 ? 'candidate is' : 'candidates are'} trending up. Review the evidence in Analytics.
        </Link>
      ) : null}

      {data.archiveError ? null : data.rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-panel border border-dashed border-border bg-panel p-8">
          <h2 className="text-sm font-medium text-foreground">
            {data.sourceRows.length === 0 ? 'Nothing to recommend yet' : 'All products are archived'}
          </h2>
          <p className="max-w-prose text-sm text-muted">
            {data.sourceRows.length === 0
              ? 'No catalog SKUs found. Sync the inventory sources before reviewing supplier purchases.'
              : <>Restore a product from <Link href="/settings" className="text-accent underline underline-offset-2">Settings</Link> to show it here again.</>}
          </p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Reorder now</h2>
                <p className="mt-1 text-xs text-muted">
                  Suggested quantities count policy-eligible supply at FBA, AWD, and SVD. Change the scenario without changing saved SKU settings, or update SKU coverage in <Link href="/settings" className="text-accent underline underline-offset-2">Settings</Link>.
                </p>
              </div>
              <Badge variant="accent">{data.toReorder.length}</Badge>
            </div>
            {data.toReorder.length === 0 ? (
              <p className="rounded-panel border border-dashed border-border bg-panel p-4 text-xs text-muted">
                No SKUs are at or below their reorder point.
              </p>
            ) : (
              <RecommendationTable rows={data.toReorder} trailingHeader="Suggested order (units)" variant="order" momentumBySku={data.momentumBySku} />
            )}
          </section>

          <details
            open={data.loadErrors.length > 0 || data.sourceHealth.some((source) => source.status !== 'success')}
            className="rounded-panel border border-border bg-panel p-4"
          >
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              Needs review <span className="font-normal text-muted">({data.needsReview.length})</span>
            </summary>
            <div className="mt-3">
              {data.needsReview.length === 0 ? (
                <p className="text-xs text-muted">Every active SKU has usable supply, SVD mapping, and velocity.</p>
              ) : <RecommendationTable rows={data.needsReview} trailingHeader="Status" variant="status" />}
            </div>
          </details>

          <details className="rounded-panel border border-border bg-panel p-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              Well stocked <span className="font-normal text-muted">({data.wellStocked.length})</span>
            </summary>
            <div className="mt-3">
              {data.wellStocked.length === 0 ? (
                <p className="text-xs text-muted">No SKUs are above their reorder point yet.</p>
              ) : <RecommendationTable rows={data.wellStocked} trailingHeader="Status" variant="status" />}
            </div>
          </details>
        </>
      )}

      {data.legacy.length > 0 ? (
        <details className="rounded-panel border border-border bg-panel p-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            Legacy <span className="font-normal text-muted">({data.legacy.length} SKUs with no sales in about 18 months)</span>
          </summary>
          <p className="mt-2 text-xs text-muted">
            Excluded from the working lists. Listings created in the last 12 months are never treated as legacy.
          </p>
          <div className="mt-3"><RecommendationTable rows={data.legacy} trailingHeader="Status" variant="legacy" /></div>
        </details>
      ) : null}
    </div>
  );
}
