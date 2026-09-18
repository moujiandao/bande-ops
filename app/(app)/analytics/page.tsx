import Link from 'next/link';
import { AnalyticsBasisNote } from '@/components/analytics/basis-note';
import { readAnalyticsSettings, vineAdjustmentIssue } from '@/lib/analytics/settings';
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
  type TrendKind,
  type VelocityPeriod,
} from '@/lib/analytics/sales-momentum';
import { assembleRecommendations } from '@/lib/reorder/service';
import { createClient } from '@/lib/supabase/server';
import {
  buildAnalyticsViewModel,
  parseAnalyticsViewQuery,
  type AnalyticsSearchParams,
  type AnalyticsViewQuery,
} from '@/lib/analytics/view';

function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unknown' : value.toFixed(1);
}

function formatUnits(value: number | null): string {
  return value === null ? 'Unknown' : Math.round(value).toLocaleString('en-US');
}

function formatCover(value: number | null): string {
  return value === null ? 'Unknown' : `${value} days`;
}

function formatDateRange(period: VelocityPeriod | null): string {
  if (!period) return 'No qualifying period';
  return `${period.startDate} to ${period.endDate}`;
}

function percentChange(product: SalesAnalyticsProduct): string {
  const change = product.momentum.percentageChange;
  if (change === null) return 'Unknown';
  return `${change >= 0 ? '+' : ''}${Math.round(change)}%`;
}

function trendTone(kind: TrendKind): string {
  if (kind === 'trending-up' || kind === 'sustained-growth') {
    return 'border-accent-soft bg-accent-soft text-accent-strong';
  }
  if (kind === 'trending-down') {
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
  if (day.adjustmentIssue === 'unavailable') return 'Vine evidence unavailable';
  if (day.adjustmentIssue === 'reconciliation-error') return 'Vine reconciliation error';
  if (day.adjustmentIssue === 'ambiguous-stock') return 'Vine-only, stock unknown';
  switch (day.classification) {
    case 'eligible-stocked':
      return 'Stocked';
    case 'eligible-possible-sellout':
      return 'Possible sellout';
    case 'eligible-restock':
      return 'Restock day';
    case 'eligible-shipment-evidence':
      return 'Shipment evidence';
    case 'out-of-stock':
      return 'Out of stock';
    case 'unknown':
      return 'Unknown';
  }
}

function PeriodCard({
  label,
  period,
  supporting,
}: {
  label: string;
  period: VelocityPeriod | null;
  supporting?: string;
}) {
  return (
    <div className="rounded-panel border border-border bg-panel p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
        {period ? `${period.dailyVelocity.toFixed(1)} / day` : 'Unknown'}
      </p>
      <p className="mt-1 text-xs text-muted">{formatDateRange(period)}</p>
      {period ? (
        <p className="mt-2 text-[11px] text-faint">
          {period.unitsShipped} units across {period.eligibleDays} eligible days
          {` · ${period.totalShipments} total shipments · ${period.excludedVineUnits} Vine excluded`}
          {period.possibleSelloutDays > 0
            ? ` · ${period.possibleSelloutDays} possible sellout`
            : ''}
          {period.excludedStockoutDays > 0
            ? ` · ${period.excludedStockoutDays} stockout days skipped`
            : ''}
        </p>
      ) : supporting ? (
        <p className="mt-2 text-[11px] text-faint">{supporting}</p>
      ) : null}
    </div>
  );
}

function ProductDetail({ product }: { product: SalesAnalyticsProduct }) {
  const recent = product.momentum.recent ?? product.momentum.early;
  return (
    <section className="flex flex-col gap-4 rounded-panel border border-border bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold text-foreground">
            {product.sku}
          </p>
          <p className="mt-1 text-sm text-muted">{product.title}</p>
        </div>
        <Badge className={trendTone(product.momentum.trend)}>
          {trendLabel(product.momentum)}
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <PeriodCard
          label={
            product.currentEvidenceAvailable
              ? 'Recent observed'
              : 'Latest historical'
          }
          period={recent}
        />
        <PeriodCard label="Previous observed" period={product.momentum.previous} />
        <PeriodCard
          label="Best observed"
          period={product.momentum.best}
          supporting="A complete rolling window is required."
        />
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
              [
                product.currentEvidenceAvailable
                  ? 'Recent observed'
                  : 'Latest historical',
                product.coverDays.recent,
              ],
              ['Best observed', product.coverDays.best],
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
          Observed velocity uses only eligible selling days. Unknown evidence
          interrupts a qualifying window.
        </p>
        <div className="mt-3 max-h-[32rem] overflow-auto rounded-panel border border-border">
          <table className="w-full min-w-[900px] whitespace-nowrap text-xs">
            <thead className="sticky top-0 border-b border-border bg-panel text-faint">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Shipments</th>
                <th className="px-3 py-2 text-right font-medium">Vine excluded</th>
                <th className="px-3 py-2 text-right font-medium">Observed units</th>
                <th className="px-3 py-2 text-right font-medium">Start</th>
                <th className="px-3 py-2 text-right font-medium">End</th>
                <th className="px-3 py-2 text-left font-medium">Evidence</th>
                <th className="px-3 py-2 text-left font-medium">Velocity</th>
              </tr>
            </thead>
            <tbody>
              {product.momentum.days.map((day) => (
                <tr key={day.activityDate} className="border-b border-border/50">
                  <td className="px-3 py-2 tabular-nums text-foreground">
                    {day.activityDate}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {day.customerShipmentsValid === false
                      || (day.customerShipmentsValid === null && day.customerShipments === 0)
                      ? 'Unknown'
                      : day.customerShipments}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {formatUnits(day.excludedVineUnits)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {formatUnits(day.observedUnits)}
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
              {product.momentum.days.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted">
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
  const {
    windowDays,
    historyDays,
    filter,
    sort,
    query,
    selectedSku,
  } = viewQuery;

  const supabase = await createClient();
  const [recommendations, history, analyticsSettings] = await Promise.all([
    assembleRecommendations({ supabase }),
    readAnalyticsHistory({ supabase, historyDays }),
    readAnalyticsSettings(supabase),
  ]);
  const sourceIssue = analyticsSourceIssue(recommendations.sourceHealth);
  const adjustmentIssue = vineAdjustmentIssue(analyticsSettings);
  const products = buildSalesAnalytics({
    products: recommendations.rows,
    ledgerRows: history.error || analyticsSettings.excludeVine === null ? [] : history.rows,
    windowDays,
    historyDays,
    dataThroughDate: history.error ? null : history.dataThroughDate,
    currentEvidenceAvailable: !sourceIssue && !adjustmentIssue,
    excludeVine: analyticsSettings.excludeVine === true,
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
            Sales momentum and dated demand evidence alongside current usable
            inventory. Velocity counts eligible FBA selling days, including a
            shipment day that ends with zero inventory.
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          <p>Sales momentum</p>
          <p className="mt-1 text-faint">
            {!history.error && history.dataThroughDate
              ? `${sourceIssue ? 'Historical data' : 'Data'} through ${history.dataThroughDate}`
              : 'Current ledger evidence unavailable'}
          </p>
        </div>
      </header>

      <AnalyticsBasisNote settings={analyticsSettings} />
      {adjustmentIssue ? (
        <p className="rounded-panel border border-border bg-panel-muted p-4 text-xs text-foreground">
          {adjustmentIssue} Configured forecasts and order quantities are unchanged.
        </p>
      ) : null}

      {history.error || sourceIssue ? (
        <div className="rounded-panel border border-border bg-panel-muted p-4 text-xs text-foreground">
          Current analytics evidence is unavailable ({history.error ?? sourceIssue}).
          Apply migration 0020 if needed, then run the FBA ledger sync so current
          trend claims can be trusted. Existing dated history remains visible and
          is labeled historical; a history read failure leaves observed metrics unknown.
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
          ['trending', 'Trending up', summary.trending],
          ['early', 'Early launch', summary.early],
          ['constrained', 'Stock constrained (<30d)', summary.constrained],
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
          <span className="text-xs font-medium text-muted">Eligible-day window</span>
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
            <option value="change">Largest increase</option>
            <option value="recent">Recent velocity</option>
            <option value="best">Best velocity</option>
            <option value="cover">Lowest recent cover</option>
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
              Recent, previous, and best rates are units per eligible selling day.
            </p>
          </div>
          <Badge className="border-border bg-panel-muted text-muted">
            {visible.length}
          </Badge>
        </div>
        <div className="overflow-x-auto rounded-panel border border-border bg-panel">
          <table className="w-full min-w-[1180px] whitespace-nowrap text-xs">
            <thead className="border-b border-border text-faint">
              <tr className="border-b border-border/60 bg-panel-muted/40">
                <th colSpan={2} className="px-3 py-2 text-left font-semibold">Product</th>
                <th colSpan={4} className="px-3 py-2 text-center font-semibold">Inventory now</th>
                <th colSpan={4} className="px-3 py-2 text-center font-semibold">Observed velocity</th>
                <th colSpan={2} className="px-3 py-2 text-left font-semibold">Evidence</th>
              </tr>
              <tr>
                <th className="px-3 py-2 text-left font-medium">SKU</th>
                <th className="px-3 py-2 text-left font-medium">Product</th>
                <th className="px-3 py-2 text-right font-medium">Usable</th>
                <th className="px-3 py-2 text-right font-medium">Configured cover</th>
                <th className="px-3 py-2 text-right font-medium">Recent cover</th>
                <th className="px-3 py-2 text-right font-medium">Best cover</th>
                <th className="px-3 py-2 text-right font-medium">Recent</th>
                <th className="px-3 py-2 text-right font-medium">Previous</th>
                <th className="px-3 py-2 text-right font-medium">Change</th>
                <th className="px-3 py-2 text-right font-medium">Best</th>
                <th className="px-3 py-2 text-left font-medium">Signal</th>
                <th className="px-3 py-2 text-left font-medium">Best dates</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => {
                const recent =
                  product.momentum.recent ?? product.momentum.early;
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
                      {formatRate(recent?.dailyVelocity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {formatRate(product.momentum.previous?.dailyVelocity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {product.momentum.absoluteChange === null ? (
                        'Unknown'
                      ) : (
                        <>
                          <span>
                            {product.momentum.absoluteChange >= 0 ? '+' : ''}
                            {product.momentum.absoluteChange.toFixed(1)} / day
                          </span>
                          <span className="ml-1 text-[10px] text-faint">
                            ({percentChange(product)})
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {formatRate(product.momentum.best?.dailyVelocity)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={trendTone(product.momentum.trend)}>
                        {trendLabel(product.momentum)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted">
                      {formatDateRange(product.momentum.best)}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-muted">
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
