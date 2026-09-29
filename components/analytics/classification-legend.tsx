import type { AnalyticsFilter } from '@/lib/analytics/view';

export const ANALYTICS_CLASSIFICATION_OPTIONS = [
  {
    value: 'all',
    label: 'All active',
    description:
      'Every non-legacy product, including stable, declining, and historical products.',
  },
  {
    value: 'growing',
    label: 'Growing in stock',
    description:
      'Within the latest continuous stocked run, sales gained at least 0.1 unit per day with each successive day and the ending rate is at least 15% higher.',
  },
  {
    value: 'constrained',
    label: 'Stock constrained',
    description:
      'Current usable inventory provides fewer than 30 days of cover, or recent stocked runs ended in confirmed sellouts.',
  },
  {
    value: 'declining',
    label: 'Declining in stock',
    description:
      'Within the latest continuous stocked run, sales lost at least 0.1 unit per day with each successive day and the ending rate is at least 15% lower.',
  },
  {
    value: 'insufficient',
    label: 'Insufficient evidence',
    description:
      'There are fewer than 5 continuous stock-confirmed days, no observed sales, or the daily evidence cannot support a direction. Short runs ending in sellout appear under Stock constrained.',
  },
  {
    value: 'historical',
    label: 'Historical',
    description:
      'The listing is legacy, the latest in-stock run ended more than 14 days ago, or current ledger health cannot support a current claim.',
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
