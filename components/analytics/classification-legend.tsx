import type { AnalyticsFilter } from '@/lib/analytics/view';

export const ANALYTICS_CLASSIFICATION_OPTIONS = [
  {
    value: 'all',
    label: 'All active',
    description:
      'Every non-legacy product, including stable, declining, and historical products.',
  },
  {
    value: 'trending',
    label: 'Trending up',
    description:
      'Recent velocity is at least 15% and 0.1 unit per day above the previous complete window, with enough sales volume. Sustained growth is included.',
  },
  {
    value: 'growing',
    label: 'Growing in stock',
    description: 'Daily observed demand rises during a continuous, confirmed in-stock run. Giveaway-adjusted units are used when enabled.',
  },
  {
    value: 'declining',
    label: 'Declining in stock',
    description: 'Daily observed demand falls during a continuous, confirmed in-stock run.',
  },
  {
    value: 'quick-sellout',
    label: 'Stockout constrained',
    description: 'A recent confirmed in-stock run ends with a possible sellout, so observed sales may understate demand. Includes longer runs, not only the Quick sellout signal.',
  },
  {
    value: 'early',
    label: 'Early launch',
    description:
      'At least 3 eligible selling days are available, but not enough to fill the selected window for a full comparison.',
  },
  {
    value: 'constrained',
    label: 'Stock constrained',
    description:
      'Current usable inventory provides fewer than 30 days of cover at the recent observed velocity.',
  },
  {
    value: 'insufficient',
    label: 'Insufficient evidence',
    description:
      'Evidence cannot form an early-launch period or two complete comparable windows, the two windows have very low sales volume, or neither window has observed shipments. New activity after a zero-sales window is kept separate.',
  },
  {
    value: 'historical',
    label: 'Historical',
    description:
      'The listing is at least 365 days old and either has never sold or has had no sale for about 550 days, or Momentum or in-stock trend evidence is stale. Products with prior history also appear here when current source evidence is unavailable.',
  },
] as const satisfies ReadonlyArray<{
  value: AnalyticsFilter;
  label: string;
  description: string;
}>;

export function ClassificationLegend() {
  return (
    <aside
      aria-labelledby="classification-legend-heading"
      className="rounded-panel border border-border bg-panel-muted p-4"
    >
      <h2
        id="classification-legend-heading"
        className="text-sm font-semibold text-foreground"
      >
        Classification legend
      </h2>
      <p className="mt-1 text-xs text-muted">
        These filters group products by their sales evidence and current inventory.
      </p>
      <dl className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
        {ANALYTICS_CLASSIFICATION_OPTIONS.map((item) => (
          <div key={item.value}>
            <dt className="text-xs font-semibold text-foreground">
              {item.label}
            </dt>
            <dd className="mt-1 text-xs leading-5 text-muted">
              {item.description}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
