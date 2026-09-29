import Link from 'next/link';
import {
  ANALYTICS_CLASSIFICATION_OPTIONS,
  ClassificationLegend,
} from '@/components/analytics/classification-legend';
import { Badge } from '@/components/ui/badge';
import {
  analyticsSourceIssue,
  buildSalesAnalytics,
  readAnalyticsHistory,
  trendLabel,
  type SalesAnalyticsProduct,
} from '@/lib/analytics/service';
import {
  ANALYTICS_HISTORY_OPTIONS,
  ANALYTICS_WINDOW_OPTIONS,
  type ClassifiedSalesDay,
  type InStockRun,
  type InStockTrendKind,
  type VelocityPeriod,
} from '@/lib/analytics/in-stock-trend';
import {
  buildAnalyticsViewModel,
  parseAnalyticsViewQuery,
  type AnalyticsSearchParams,
  type AnalyticsViewQuery,
} from '@/lib/analytics/view';
import { assembleRecommendations } from '@/lib/reorder/service';
import { createClient } from '@/lib/supabase/server';

function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unknown' : value.toFixed(1);
}

function formatSlope(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unknown';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} units/day per in-stock day`;
}

function formatUnits(value: number | null): string {
  return value === null ? 'Unknown' : Math.round(value).toLocaleString('en-US');
}

function formatCover(value: number | null): string {
  return value === null ? 'Unknown' : `${value} days`;
}

function formatDateRange(
  period: Pick<VelocityPeriod | InStockRun, 'startDate' | 'endDate'> | null,
): string {
  if (!period) return 'No qualifying period';
  return `${period.startDate} to ${period.endDate}`;
}

function trendTone(kind: InStockTrendKind): string {
  if (kind === 'growing') {
    return 'border-accent-soft bg-accent-soft text-accent-strong';
  }
  if (kind === 'declining' || kind === 'quick-sellout') {
    return 'border-border-strong bg-panel-muted text-foreground';
  }
  return 'border-border bg-panel-muted text-muted';
}

function analyticsHref(
  current: Pick<
    AnalyticsViewQuery,
    'windowDays' | 'historyDays' | 'filter' | 'sort' | 'query'
  >,
  changes: Record<string, string | null>,
): string {
  const params = new URLSearchParams({
    window: String(current.windowDays),
    history: String(current.historyDays),
    filter: current.filter,
    sort: current.sort,
  });
  if (current.query) params.set('q', current.query);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') params.delete(key);
    else params.set(key, value);
  }
  return `/analytics?${params.toString()}`;
}

function evidenceLabel(day: ClassifiedSalesDay): string {
  switch (day.classification) {
    case 'eligible-stocked':
      return 'Stock confirmed';
    case 'eligible-possible-sellout':
      return 'Confirmed sellout';
    case 'eligible-restock':
      return 'Restock day';
    case 'shipment-only-evidence':
      return 'Shipment only';
    case 'out-of-stock':
      return 'Out of stock';
    case 'unknown':
      return 'Unknown';
  }
}

function ProductDetail({ product }: { product: SalesAnalyticsProduct }) {
  const run = product.trend.latestRun;
  const best = product.trend.best;
  return (
    <section className="flex flex-col gap-4 rounded-panel border border-border bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold text-foreground">
            {product.sku}
          </p>
          <p className="mt-1 text-sm text-muted">{product.title}</p>
        </div>
        <Badge className={trendTone(product.trend.trend)}>
          {trendLabel(product.trend)}
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-panel border border-border bg-panel p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
            Latest in-stock average
          </p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
            {run ? `${run.averageVelocity.toFixed(1)} / day` : 'Unknown'}
          </p>
          <p className="mt-1 text-xs text-muted">{formatDateRange(run)}</p>
          {run ? (
            <p className="mt-2 text-[11px] text-faint">
              {run.unitsShipped} units across {run.eligibleDays} confirmed in-stock days
              {run.endedInSellout ? ' · ended in sellout' : ''}
            </p>
          ) : null}
        </div>
        <div className="rounded-panel border border-border bg-panel p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
            In-stock trend
          </p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
            {formatSlope(run?.slopePerDay)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {run
              ? `${run.startVelocity.toFixed(1)} → ${run.endVelocity.toFixed(1)} units/day`
              : 'No qualifying run'}
          </p>
          <p className="mt-2 text-[11px] capitalize text-faint">
            {product.trend.confidence} confidence
            {product.trend.qualifyingRuns > 0
              ? ` · Growing in ${product.trend.growingRuns} of ${product.trend.qualifyingRuns} qualifying runs`
              : ''}
          </p>
        </div>
        <div className="rounded-panel border border-border bg-panel p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
            Best sustained velocity
          </p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
            {best ? `${best.dailyVelocity.toFixed(1)} / day` : 'Unknown'}
          </p>
          <p className="mt-1 text-xs text-muted">{formatDateRange(best)}</p>
          {best ? (
            <p className="mt-2 text-[11px] text-faint">
              {best.unitsShipped} units across {best.eligibleDays} continuous in-stock days
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-faint">
              A complete selected-window run is required.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-panel border border-border bg-panel-muted p-4">
          <h3 className="text-sm font-semibold text-foreground">Inventory now</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            {[
              ['FBA fulfillable', product.fba],
              ['Counted FBA inbound', product.fbaInbound],
              ['AWD', product.awd],
              ['SVD', product.svd],
              ['Total usable', product.usableSupply],
            ].map(([label, value]) => (
              <div key={String(label)} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right font-medium tabular-nums text-foreground">
                  {formatUnits(value as number | null)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-panel border border-border bg-panel-muted p-4">
          <h3 className="text-sm font-semibold text-foreground">Days of cover</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            {[
              ['Configured forecast', product.coverDays.configured],
              ['Latest in-stock average', product.coverDays.recent],
              ['Best sustained', product.coverDays.best],
            ].map(([label, value]) => (
              <div key={String(label)} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right font-medium tabular-nums text-foreground">
                  {formatCover(value as number | null)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] text-faint">
            Scenarios use the same current usable supply. They do not change saved
            reorder settings.
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground">Daily evidence</h3>
        <p className="mt-1 text-xs text-muted">
          Trend calculations use continuous stock-confirmed days. Stockouts,
          shipment-only evidence, unknown data, and missing dates split runs.
        </p>
        <div className="mt-3 max-h-[32rem] overflow-auto rounded-panel border border-border">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="sticky top-0 border-b border-border bg-panel text-faint">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Shipments</th>
                <th className="px-3 py-2 text-right font-medium">Start</th>
                <th className="px-3 py-2 text-right font-medium">End</th>
                <th className="px-3 py-2 text-left font-medium">Evidence</th>
                <th className="px-3 py-2 text-left font-medium">Trend run</th>
              </tr>
            </thead>
            <tbody>
              {product.trend.days.map((day) => (
                <tr key={day.activityDate} className="border-b border-border/50">
                  <td className="px-3 py-2 tabular-nums text-foreground">
                    {day.activityDate}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {day.customerShipmentsValid === true
                      ? day.customerShipments
                      : 'Unknown'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {day.startingBalanceValid === true
                      ? formatUnits(day.startingBalance)
                      : 'Unknown'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {day.endingBalanceValid === true
                      ? formatUnits(day.endingBalance)
                      : 'Unknown'}
                  </td>
                  <td className="px-3 py-2 text-muted">{evidenceLabel(day)}</td>
                  <td className="px-3 py-2">
                    <span className={day.eligible ? 'text-accent-strong' : 'text-faint'}>
                      {day.eligible ? 'Included' : 'Excluded'}
                    </span>
                  </td>
                </tr>
              ))}
              {product.trend.days.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted">
                    No ledger evidence in the selected history.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  const params = await searchParams;
  const viewQuery = parseAnalyticsViewQuery(params);
  const { windowDays, historyDays, filter, sort, query, selectedSku } = viewQuery;

  const supabase = await createClient();
  const [recommendations, history] = await Promise.all([
    assembleRecommendations({ supabase }),
    readAnalyticsHistory({ supabase, historyDays }),
  ]);
  const sourceIssue = analyticsSourceIssue(recommendations.sourceHealth);
  const products = buildSalesAnalytics({
    products: recommendations.rows,
    ledgerRows: history.error ? [] : history.rows,
    windowDays,
    historyDays,
    dataThroughDate: history.error ? null : history.dataThroughDate,
    currentEvidenceAvailable: !sourceIssue,
  });
  const current = viewQuery;
  const { selected, visible, summary } = buildAnalyticsViewModel(
    products,
    viewQuery,
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Advanced Analytics
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            In-stock sales trends and dated demand evidence alongside current
            usable inventory. Each trend stays inside one continuous,
            stock-confirmed run.
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          <p>In-stock sales trend</p>
          <p className="mt-1 text-faint">
            {!history.error && history.dataThroughDate
              ? `Analysis cutoff ${history.dataThroughDate}`
              : 'Current ledger evidence unavailable'}
          </p>
        </div>
      </header>

      {history.error || sourceIssue ? (
        <div className="rounded-panel border border-border bg-panel-muted p-4 text-xs text-foreground">
          Current in-stock evidence is unavailable ({history.error ?? sourceIssue}).
          Refresh the FBA ledger so current trend claims can be trusted. Existing
          dated runs remain visible and are labeled historical.
        </div>
      ) : null}
      {Object.values(recommendations.errors).some(Boolean) ? (
        <div className="rounded-panel border border-border bg-panel-muted p-4 text-xs text-foreground">
          One or more inventory sources failed to load. Unknown scenario values
          remain unknown and are not treated as zero.
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ['growing', 'Growing in stock', summary.growing],
          ['constrained', 'Stockout constrained', summary.constrained],
          ['declining', 'Declining in stock', summary.declining],
          ['insufficient', 'Insufficient evidence', summary.insufficient],
        ] as const).map(([key, label, count]) => (
          <Link
            key={key}
            href={analyticsHref(current, { filter: key, sku: null })}
            className={`rounded-panel border p-4 transition-colors hover:border-accent ${
              filter === key
                ? 'border-accent bg-accent-soft'
                : 'border-border bg-panel'
            }`}
          >
            <p className="text-xs font-medium text-muted">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
              {count}
            </p>
          </Link>
        ))}
      </section>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-panel border border-border bg-panel p-4"
      >
        {selectedSku ? <input type="hidden" name="sku" value={selectedSku} /> : null}
        <label className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="SKU or product title"
            className="rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">In-stock trend window</span>
          <select
            name="window"
            defaultValue={windowDays}
            className="rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            {ANALYTICS_WINDOW_OPTIONS.map((option) => (
              <option key={option} value={option}>{option} days</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">History</span>
          <select
            name="history"
            defaultValue={historyDays}
            className="rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            {ANALYTICS_HISTORY_OPTIONS.map((option) => (
              <option key={option} value={option}>{option} days</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Classification</span>
          <select
            name="filter"
            defaultValue={filter}
            className="rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            {ANALYTICS_CLASSIFICATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Sort</span>
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            <option value="slope">Steepest growth</option>
            <option value="latest">Latest in-stock velocity</option>
            <option value="best">Best sustained velocity</option>
            <option value="cover">Lowest latest cover</option>
            <option value="sku">SKU</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          Apply
        </button>
      </form>

      <ClassificationLegend />

      {selected ? <ProductDetail product={selected} /> : selectedSku ? (
        <div className="rounded-panel border border-border bg-panel p-4 text-sm text-muted">
          SKU {selectedSku} was not found in the current FBA product universe.
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Products</h2>
            <p className="mt-1 text-xs text-muted">
              Trend per day shows the robust change in daily sales for each
              successive stock-confirmed day.
            </p>
          </div>
          <Badge className="border-border bg-panel-muted text-muted">
            {visible.length}
          </Badge>
        </div>
        <div className="overflow-x-auto rounded-panel border border-border bg-panel">
          <table className="w-full min-w-[1480px] whitespace-nowrap text-xs">
            <thead className="border-b border-border text-faint">
              <tr className="border-b border-border/60 bg-panel-muted/40">
                <th colSpan={2} className="px-3 py-2 text-left font-semibold">Product</th>
                <th colSpan={4} className="px-3 py-2 text-center font-semibold">Inventory now</th>
                <th colSpan={5} className="px-3 py-2 text-center font-semibold">In-stock trend</th>
                <th colSpan={4} className="px-3 py-2 text-left font-semibold">Evidence</th>
              </tr>
              <tr>
                <th className="px-3 py-2 text-left font-medium">SKU</th>
                <th className="px-3 py-2 text-left font-medium">Product</th>
                <th className="px-3 py-2 text-right font-medium">Usable</th>
                <th className="px-3 py-2 text-right font-medium">Configured cover</th>
                <th className="px-3 py-2 text-right font-medium">Latest cover</th>
                <th className="px-3 py-2 text-right font-medium">Best cover</th>
                <th className="px-3 py-2 text-right font-medium">Latest avg</th>
                <th className="px-3 py-2 text-right font-medium">Start</th>
                <th className="px-3 py-2 text-right font-medium">End</th>
                <th className="px-3 py-2 text-right font-medium">Velocity change</th>
                <th className="px-3 py-2 text-right font-medium">Best</th>
                <th className="px-3 py-2 text-left font-medium">Signal</th>
                <th className="px-3 py-2 text-left font-medium">Confidence</th>
                <th className="px-3 py-2 text-right font-medium">Growing runs</th>
                <th className="px-3 py-2 text-left font-medium">Latest run</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => {
                const run = product.trend.latestRun;
                return (
                  <tr key={product.sku} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-mono text-foreground">
                      <Link
                        href={analyticsHref(current, { sku: product.sku })}
                        className="underline-offset-2 hover:text-accent-strong hover:underline"
                      >
                        {product.sku}
                      </Link>
                    </td>
                    <td className="max-w-[250px] truncate px-3 py-2 text-muted" title={product.title}>
                      {product.title}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {formatUnits(product.usableSupply)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {formatCover(product.coverDays.configured)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {formatCover(product.coverDays.recent)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {formatCover(product.coverDays.best)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {formatRate(run?.averageVelocity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {formatRate(run?.startVelocity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {formatRate(run?.endVelocity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {formatSlope(run?.slopePerDay)}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums text-muted"
                      title={formatDateRange(product.trend.best)}
                    >
                      {formatRate(product.trend.best?.dailyVelocity)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={trendTone(product.trend.trend)}>
                        {trendLabel(product.trend)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 capitalize text-muted">
                      {product.trend.confidence}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {product.trend.qualifyingRuns > 0
                        ? `${product.trend.growingRuns} / ${product.trend.qualifyingRuns}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted">
                      {formatDateRange(run)}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-3 py-10 text-center text-muted">
                    No products match these controls.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
