import { createClient } from '@/lib/supabase/server';
import { getDemandProvider } from '@/lib/reorder/demand';
import {
  assembleRecommendations,
  type RecommendationRow,
} from '@/lib/reorder/service';
import { Badge } from '@/components/ui/badge';

/**
 * Reorder recommendations (Module 1: Catalog & Inventory) — decision-support
 * ONLY. Recommends a quantity + the reasoning behind it; it writes nothing back
 * to Amazon (no POs, no FBA shipments).
 *
 * Server component. Assembles per-SKU recommendations through the dependency-
 * injected service: the authenticated Supabase server client (RLS) supplies the
 * inventory mirror + replenishment settings, and getDemandProvider() supplies
 * demand (the Fake when AMAZON_USE_FAKE=true; otherwise the SP-API ledger
 * skeleton). Recompute is implicit: this is a server component, so each request
 * re-reads the latest mirror/settings/demand.
 *
 * UNKNOWN is rendered distinctly: a SKU with UNKNOWN on-hand or UNKNOWN demand
 * shows a "Needs review" state, NEVER a number — the same money-critical rule the
 * recommender enforces.
 */

function reorderQty(row: RecommendationRow): number {
  return row.recommendation.status === 'ok'
    ? row.recommendation.recommendedQty
    : 0;
}

/** Human-readable label for a needs-review reason code. */
const REVIEW_REASON_LABELS: Record<string, string> = {
  'unknown-on-hand': 'On-hand is Unknown (Amazon reported no quantity)',
  'unknown-demand': 'Demand is Unknown (no usable ledger window)',
  'invalid-on-hand': 'On-hand value is invalid',
  'invalid-demand': 'Demand value is invalid',
  'invalid-lead-time': 'Lead time is invalid',
  'invalid-safety-stock': 'Safety stock is invalid',
};

function fmtDemand(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export default async function ReorderPage() {
  const supabase = await createClient();
  const demand = getDemandProvider();

  const { rows, errors } = await assembleRecommendations({ supabase, demand });

  // Partition for the view: SKUs to actually reorder (qty > 0) lead, then
  // well-stocked (ok, qty 0), then the needs-review SKUs (no number).
  const toReorder = rows
    .filter((r) => r.recommendation.status === 'ok' && reorderQty(r) > 0)
    .sort((a, b) => reorderQty(b) - reorderQty(a));
  const wellStocked = rows.filter(
    (r) => r.recommendation.status === 'ok' && reorderQty(r) === 0,
  );
  const needsReview = rows.filter(
    (r) => r.recommendation.status === 'needs-review',
  );

  const hasReadError = Boolean(errors.catalog || errors.inventory || errors.settings);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Reorder recommendations
        </h1>
        <p className="max-w-prose text-sm text-muted">
          Recommended order quantities from on-hand, demand (FBA ledger,
          PII-free), lead time, and safety stock. Decision-support only — nothing
          here writes back to Amazon. SKUs with Unknown stock or demand are flagged
          for review, never given a number.
        </p>
      </header>

      {hasReadError ? (
        <div className="rounded-panel border border-border bg-panel-muted p-3 text-xs text-foreground">
          ⚠ A source failed to load
          {errors.inventory ? ` (inventory: ${errors.inventory})` : ''}
          {errors.settings ? ` (settings: ${errors.settings})` : ''}
          {errors.catalog ? ` (catalog: ${errors.catalog})` : ''}. Some rows may
          read &ldquo;Needs review&rdquo; because of this load error, not because
          Amazon reported them as Unknown.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-panel border border-dashed border-border bg-panel p-8">
          <h2 className="text-sm font-medium text-foreground">
            Nothing to recommend yet
          </h2>
          <p className="max-w-prose text-sm text-muted">
            No catalog SKUs found. Sync the catalog and inventory first, then set
            replenishment defaults in Settings.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Reorder now */}
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
                  // status is 'ok' here by construction.
                  const rec = row.recommendation;
                  if (rec.status !== 'ok') return null;
                  const r = rec.reasoning;
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
                        <span className="text-xs text-faint">
                          On-hand {r.onHand} · demand {fmtDemand(r.dailyDemand)}/day ·
                          lead {r.leadTimeDays}d · safety {r.safetyStock} · reorder
                          point {fmtDemand(r.reorderPoint)}
                        </span>
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

          {/* Needs review (UNKNOWN — never a number) */}
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Needs review</h2>
              <Badge className="border-border bg-panel-muted text-muted">
                {needsReview.length}
              </Badge>
            </div>
            {needsReview.length === 0 ? (
              <p className="rounded-panel border border-dashed border-border bg-panel p-4 text-xs text-muted">
                Every SKU has a known on-hand and demand.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {needsReview.map((row) => {
                  const rec = row.recommendation;
                  const reason =
                    rec.status === 'needs-review'
                      ? (REVIEW_REASON_LABELS[rec.reason] ?? rec.reason)
                      : '';
                  return (
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
                        <span className="text-xs text-faint">{reason}</span>
                      </div>
                      <Badge className="border-border bg-panel-muted text-muted">
                        Needs review
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Well stocked */}
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
                {wellStocked.map((row) => {
                  const rec = row.recommendation;
                  if (rec.status !== 'ok') return null;
                  const r = rec.reasoning;
                  return (
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
                        <span className="text-xs text-faint">
                          On-hand {r.onHand} · demand {fmtDemand(r.dailyDemand)}/day ·
                          reorder point {fmtDemand(r.reorderPoint)}
                        </span>
                      </div>
                      <span className="text-xs font-medium text-muted">No reorder</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
