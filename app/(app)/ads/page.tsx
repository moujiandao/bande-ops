import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import type { AdsCampaignRow } from '@/lib/ads/types';
import { syncAdsAction } from './actions';

/**
 * Ads (Module 2, slice A1) — the Sponsored Products campaign list view.
 *
 * Server component. Reads the `ads_campaigns` synced mirror through the
 * authenticated Supabase server client (RLS) and renders name, state, and daily
 * budget. The mirror is rebuildable from the Amazon Advertising API (ADR-0001);
 * "Sync now" repopulates it via the service-role write path. UNKNOWN-budget
 * rule: a null daily_budget renders a distinct "Unknown" badge, NEVER as 0.
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

export default async function AdsPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('ads_campaigns')
    .select('marketplace_id, campaign_id, name, state, daily_budget, synced_at')
    .order('name', { ascending: true });

  const rows = (data ?? []) as AdsCampaignRow[];
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isUnknownBudget = row.daily_budget === null;
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
                        <span title="Amazon did not report a budget - flagged for review">
                          <Badge variant="soon">Unknown</Badge>
                        </span>
                      ) : (
                        <span className="font-mono text-xs tabular-nums text-foreground">
                          {formatBudget(row.daily_budget)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
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
