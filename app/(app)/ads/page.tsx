import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import type { AdsCampaignRow, AdsCampaignMetricsRow } from '@/lib/ads/types';
import { acos, roas } from '@/lib/ads/metrics';
import { syncAdsAction } from './actions';

/**
 * Ads (Module 2, slices A1 + A2) — Sponsored Products campaign list with
 * performance metrics.
 *
 * Server component. Reads the `ads_campaigns` and `ads_campaign_metrics` synced
 * mirrors through the authenticated Supabase server client (RLS), joins them by
 * the natural key (marketplace_id, campaign_id), and renders name, state, daily
 * budget, spend, sales, ACOS, and ROAS. The mirrors are rebuildable from the
 * Amazon Advertising API (ADR-0001); "Sync now" repopulates them via the
 * service-role write path.
 *
 * UNKNOWN rules: a null daily_budget, a null metric, an absent metrics row, or a
 * computed-UNKNOWN ACOS/ROAS (divide-by-zero -> null) all render a distinct
 * muted "Unknown" badge, NEVER as 0 or $0. ACOS/ROAS are COMPUTED here from
 * cost/sales via lib/ads/metrics.ts — never stored.
 */

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function mostRecentSyncedAt(rows: AdsCampaignRow[]): string | null {
  if (rows.length === 0) return null;
  return rows.reduce(
    (latest, row) => (row.synced_at > latest ? row.synced_at : latest),
    rows[0].synced_at,
  );
}

const stateVariant: Record<string, 'default' | 'soon' | 'accent'> = {
  enabled: 'accent',
  paused: 'default',
  archived: 'soon',
};

function formatBudget(value: number | null): string {
  // UNKNOWN (null) is distinct from a true 0 — never render null as "$0".
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

/** Format a computed ACOS ratio as a percentage (0.2 -> "20.0%"). */
function formatAcos(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** Format a computed ROAS ratio as a multiple (5 -> "5.00x"). */
function formatRoas(value: number): string {
  return `${value.toFixed(2)}x`;
}

const metricKey = (marketplaceId: string, campaignId: string): string =>
  `${marketplaceId}:${campaignId}`;

/** A muted badge for any UNKNOWN cell (null metric, absent row, or null ratio). */
function UnknownCell({ title }: { title: string }) {
  return (
    <span title={title}>
      <Badge variant="soon">Unknown</Badge>
    </span>
  );
}

export default async function AdsPage() {
  const supabase = await createClient();

  const [campaignsRes, metricsRes] = await Promise.all([
    supabase
      .from('ads_campaigns')
      .select(
        'marketplace_id, campaign_id, name, state, daily_budget, synced_at',
      )
      .order('name', { ascending: true }),
    supabase
      .from('ads_campaign_metrics')
      .select(
        'marketplace_id, campaign_id, impressions, clicks, cost, sales, synced_at',
      ),
  ]);

  const { data, error } = campaignsRes;
  const rows = (data ?? []) as AdsCampaignRow[];

  // Join metrics by the natural key (marketplace_id, campaign_id). A missing
  // entry means UNKNOWN (no metrics synced for this campaign), NEVER 0.
  const metricsRows = (metricsRes.data ?? []) as AdsCampaignMetricsRow[];
  const metricsByKey = new Map<string, AdsCampaignMetricsRow>(
    metricsRows.map((m) => [metricKey(m.marketplace_id, m.campaign_id), m]),
  );

  // Don't let a metrics READ FAILURE masquerade as legitimately-absent metrics
  // (which render as UNKNOWN). Surface it instead of silently blanking to Unknown.
  const metricsError = metricsRes.error;
  if (metricsError) {
    console.error('ads: ads_campaign_metrics read failed', metricsError);
  }

  const lastSynced = mostRecentSyncedAt(rows);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Ads
          </h1>
          <p className="max-w-prose text-sm text-muted">
            Synced mirror of your Sponsored Products campaigns. Amazon is the
            source of truth; this view is rebuildable and shows when it was last
            pulled.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastSynced ? (
            <span className="text-xs text-muted">
              Last synced{' '}
              <time dateTime={lastSynced} className="font-medium text-foreground">
                {formatTimestamp(lastSynced)}
              </time>
            </span>
          ) : (
            <span className="text-xs text-faint">Never synced</span>
          )}
          <form action={syncAdsAction}>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-panel-muted"
            >
              Sync now
            </button>
          </form>
        </div>
      </header>

      {metricsError ? (
        <div className="rounded-panel border border-border bg-panel-muted p-3 text-xs text-foreground">
          ⚠ Campaign metrics failed to load ({metricsError.message}). Spend / ACOS
          / ROAS below read &ldquo;Unknown&rdquo; because of this load error — not
          because Amazon reported them as unknown.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-panel border border-border bg-panel p-5 text-sm text-muted">
          Couldn&apos;t load the campaigns mirror: {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-panel border border-dashed border-border bg-panel p-8">
          <h2 className="text-sm font-medium text-foreground">
            No campaigns yet
          </h2>
          <p className="max-w-prose text-sm text-muted">
            The mirror is empty. Run a sync to pull your Sponsored Products
            campaigns from Amazon into this view.
          </p>
          <form action={syncAdsAction}>
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:opacity-90"
            >
              Sync now
            </button>
          </form>
        </div>
      ) : (
        <div className="overflow-hidden rounded-panel border border-border bg-panel">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-faint">
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 text-right font-medium">Daily budget</th>
                <th className="px-4 py-3 text-right font-medium">Spend</th>
                <th className="px-4 py-3 text-right font-medium">Sales</th>
                <th className="px-4 py-3 text-right font-medium">ACOS</th>
                <th className="px-4 py-3 text-right font-medium">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isUnknownBudget = row.daily_budget === null;

                // Joined metrics (may be absent -> all UNKNOWN, never 0).
                const metrics = metricsByKey.get(
                  metricKey(row.marketplace_id, row.campaign_id),
                );
                const cost = metrics?.cost ?? null;
                const sales = metrics?.sales ?? null;
                // ACOS/ROAS are COMPUTED here; divide-by-zero -> null (UNKNOWN).
                const acosValue = acos(cost, sales);
                const roasValue = roas(sales, cost);

                return (
                  <tr
                    key={`${row.marketplace_id}:${row.campaign_id}`}
                    className="border-b border-border last:border-b-0 align-top"
                  >
                    <td className="px-4 py-3 text-foreground">{row.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant={stateVariant[row.state] ?? 'default'}>
                        {row.state}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isUnknownBudget ? (
                        // UNKNOWN (null): a muted badge, visually distinct from a
                        // numeric 0. Never rendered as "$0".
                        <UnknownCell title="Amazon did not report a budget - flagged for review" />
                      ) : (
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {formatBudget(row.daily_budget)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {cost === null ? (
                        <UnknownCell title="No ad spend reported - flagged for review" />
                      ) : (
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {formatCurrency(cost)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {sales === null ? (
                        <UnknownCell title="No sales reported - flagged for review" />
                      ) : (
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {formatCurrency(sales)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {acosValue === null ? (
                        // UNKNOWN ACOS: no sales (divide-by-zero) or no data.
                        // Never 0, never "Infinity".
                        <UnknownCell title="ACOS is UNKNOWN (no sales or no spend data) - never shown as 0%" />
                      ) : (
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {formatAcos(acosValue)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {roasValue === null ? (
                        <UnknownCell title="ROAS is UNKNOWN (no spend or no sales data) - never shown as 0x" />
                      ) : (
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {formatRoas(roasValue)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>
                  <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
                    <span className="text-[11px] text-faint">
                      {rows.length} campaign{rows.length === 1 ? '' : 's'}
                    </span>
                    <Badge className="border-border bg-panel-muted text-muted">
                      US
                    </Badge>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
