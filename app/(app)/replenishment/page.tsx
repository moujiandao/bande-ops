import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { SourceStatus } from '@/components/replenishment/source-status';
import { WorkflowSwitch } from '@/components/replenishment/workflow-switch';
import { RefreshSvdButton } from '@/components/replenishment/refresh-svd-button';
import { formatShipmentMonthYear, svdShipmentDraftKey } from '@/lib/reorder/replenish';
import { loadReorderWorkflowData } from '@/lib/reorder/workflow-data';
import { requireUser } from '@/lib/auth/guard';
import { RecommendationTable } from '@/components/inventory-planning/recommendation-table';

export default async function ReplenishmentPage() {
  const [data, user] = await Promise.all([loadReorderWorkflowData(), requireUser()]);
  const shipmentMonthYear = formatShipmentMonthYear(new Date());

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Warehouse transfer</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">FBA Replenishment</h1>
          <p className="max-w-prose text-sm text-muted">
            Move existing inventory from SVD to FBA. This page prepares a shipment recommendation and does not create an Amazon shipment.
          </p>
        </div>
        <RefreshSvdButton />
      </header>

      <WorkflowSwitch current="replenishment" />

      <SourceStatus sourceHealth={data.sourceHealth} loadErrors={data.loadErrors} />

      {data.archiveError ? (
        <div className="rounded-panel border border-border bg-panel-muted p-3 text-xs text-foreground">
          Archived products could not be loaded ({data.archiveError}). Product lists are hidden so archived SKUs cannot reappear accidentally.
        </div>
      ) : null}

      {data.archiveError ? null : data.rows.length === 0 ? (
        <div className="rounded-panel border border-dashed border-border bg-panel p-8 text-sm text-muted">
          {data.sourceRows.length === 0 ? 'No products are available for transfer planning yet.' : <>All products are archived. Restore products in <Link href="/settings" className="text-accent underline underline-offset-2">Settings</Link>.</>}
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Recommended transfers</h2>
              <p className="mt-1 max-w-prose text-xs text-muted">
                Below {data.policy.svdToFbaTargetDays} days of Amazon cover, with inventory available at SVD. Amazon cover counts policy-eligible FBA and AWD supply, and intentionally excludes SVD stock. Update the transfer target in <Link href="/settings" className="text-accent underline underline-offset-2">Settings</Link>.
              </p>
            </div>
            <Badge variant="accent">{data.replenishFromSvd.length}</Badge>
          </div>
          {data.replenishFromSvd.length === 0 ? (
            <p className="rounded-panel border border-dashed border-border bg-panel p-4 text-xs text-muted">
              No active SKUs need a transfer to reach {data.policy.svdToFbaTargetDays} days of Amazon cover.
            </p>
          ) : (
            <RecommendationTable
              key={svdShipmentDraftKey(
                data.replenishFromSvd,
                data.policy.svdToFbaTargetDays,
                shipmentMonthYear,
              )}
              rows={data.replenishFromSvd}
              trailingHeader="Suggested units"
              variant="replenish"
              svdToFbaTargetDays={data.policy.svdToFbaTargetDays}
              shipmentMonthYear={shipmentMonthYear}
              momentumBySku={data.momentumBySku}
              userId={user.id}
            />
          )}
        </section>
      )}

      <details
        open={data.loadErrors.length > 0 || data.sourceHealth.some((source) => source.status !== 'success')}
        className="rounded-panel border border-border bg-panel p-4"
      >
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Transfer review <span className="font-normal text-muted">({data.needsReview.length} SKUs)</span>
        </summary>
        <p className="mt-2 text-xs text-muted">
          These rows need source data, mapping, or box configuration before they can be considered for transfer planning.
        </p>
        {data.needsReview.length > 0 ? (
          <div className="mt-3"><RecommendationTable rows={data.needsReview} trailingHeader="Status" variant="status" /></div>
        ) : null}
      </details>

      <details className="rounded-panel border border-border bg-panel p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          All active products <span className="font-normal text-muted">({data.active.length} SKUs)</span>
        </summary>
        <p className="mt-2 text-xs text-muted">
          Inspect the full active catalog, including SKUs that do not currently need a transfer.
        </p>
        <div className="mt-3"><RecommendationTable rows={data.active} trailingHeader="Status" variant="status" /></div>
      </details>

      {data.legacy.length > 0 ? (
        <details className="rounded-panel border border-border bg-panel p-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            Legacy <span className="font-normal text-muted">({data.legacy.length} SKUs with no sales in about 18 months)</span>
          </summary>
          <div className="mt-3"><RecommendationTable rows={data.legacy} trailingHeader="Status" variant="legacy" /></div>
        </details>
      ) : null}
    </div>
  );
}
