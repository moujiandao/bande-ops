import { createClient } from '@/lib/supabase/server';
import type { AdsCampaignRow, AdsCampaignMetricsRow } from '@/lib/ads/types';
import { DEFAULT_MARKETPLACE } from '@/lib/ads/types';
import { syncAdsAction } from './actions';
import { updateAcosTargetAction } from '@/lib/ads/rules-actions';
import { AdsTable, type AdsTableRow } from './ads-table';

/**
 * Ads (Module 2, slices A1 + A2 + A4) — Sponsored Products campaign list with
 * performance metrics, made actionable.
 *
 * Server component. Reads the `ads_campaigns` and `ads_campaign_metrics` synced
 * mirrors plus the `ads_rules` ACOS target (operational, user-authored) through
 * the authenticated Supabase server client (RLS), joins campaigns to metrics by
 * the natural key (marketplace_id, campaign_id), and hands the raw rows to a
 * client table that adds search, sort (by spend / ACOS), and per-campaign
 * wasted-spend flags. The mirrors are rebuildable from the Amazon Advertising
 * API (ADR-0001); "Sync now" repopulates them via the service-role write path.
 *
 * UNKNOWN rules: a null daily_budget, a null metric, an absent metrics row, or a
 * computed-UNKNOWN ACOS/ROAS all render a distinct muted "Unknown" badge, NEVER
 * as 0 or $0. ACOS/ROAS are COMPUTED (never stored); flags never trip on UNKNOWN
 * data. Decision-support only — nothing here writes back to Amazon.
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

const metricKey = (marketplaceId: string, campaignId: string): string =>
  `${marketplaceId}:${campaignId}`;

type AdsRuleRow = {
  marketplace_id: string;
  acos_target: number;
  updated_at: string;
};

export default async function AdsPage() {
  const supabase = await createClient();

  const [campaignsRes, metricsRes, ruleRes] = await Promise.all([
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
    supabase
      .from('ads_rules')
      .select('marketplace_id, acos_target, updated_at')
      .eq('marketplace_id', DEFAULT_MARKETPLACE.id)
      .maybeSingle(),
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

  // ACOS target (operational, user-authored) is stored as a RATIO; the editor
  // below displays/edits it as a percent. null = not set yet (no 'high-acos').
  // A failed read looks identical to "not set" and would silently drop every
  // high-ACOS flag — surface it rather than swallow.
  if (ruleRes.error) {
    console.error('ads: ads_rules read failed', ruleRes.error);
  }
  const rule = (ruleRes.data ?? null) as AdsRuleRow | null;
  const acosTarget = rule?.acos_target ?? null;
  const acosTargetPercent = acosTarget !== null ? acosTarget * 100 : null;

  // Build raw rows for the client table; it computes ACOS/ROAS/flags itself.
  const tableRows: AdsTableRow[] = rows.map((row) => {
    const metrics = metricsByKey.get(metricKey(row.marketplace_id, row.campaign_id));
    return {
      marketplace_id: row.marketplace_id,
      campaign_id: row.campaign_id,
      name: row.name,
      state: row.state,
      daily_budget: row.daily_budget,
      cost: metrics?.cost ?? null,
      sales: metrics?.sales ?? null,
    };
  });

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
            source of truth; this view is rebuildable and flags wasted spend
            against your ACOS target. Decision-support only — nothing here writes
            back to Amazon.
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

      {/* ACOS target editor (operational, user-authored). Drives 'high-acos'. */}
      <section className="flex flex-col gap-2 rounded-panel border border-border bg-panel p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">ACOS target</h2>
          {rule ? (
            <span className="text-[11px] text-faint">
              Updated {formatTimestamp(rule.updated_at)}
            </span>
          ) : (
            <span className="text-[11px] text-faint">Not set yet</span>
          )}
        </div>
        <p className="max-w-prose text-xs text-muted">
          Campaigns whose computed ACOS exceeds this target are flagged{' '}
          <span className="font-medium text-foreground">High ACOS</span>. Entered
          as a percentage.
        </p>
        <form action={updateAcosTargetAction} className="flex items-end gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Target ACOS (%)</span>
            <input
              type="number"
              name="acosTargetPercent"
              min={0}
              step="0.1"
              required
              defaultValue={acosTargetPercent ?? ''}
              placeholder="e.g. 25"
              className="w-32 rounded-md border border-border bg-panel px-3 py-1.5 text-sm text-foreground tabular-nums focus:border-accent focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:opacity-90"
          >
            Save target
          </button>
        </form>
      </section>

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
          <h2 className="text-sm font-medium text-foreground">No campaigns yet</h2>
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
        <AdsTable rows={tableRows} acosTarget={acosTarget} />
      )}
    </div>
  );
}
