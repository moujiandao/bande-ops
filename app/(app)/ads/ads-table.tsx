'use client';

import { useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { acos, roas } from '@/lib/ads/metrics';
import { classifyCampaign, type CampaignFlag } from '@/lib/ads/classify';
import {
  recommendCampaignActions,
  type Recommendation,
} from '@/lib/ads/recommend';
import {
  searchCampaigns,
  sortBySpend,
  sortByAcos,
  type SortDirection,
} from '@/lib/ads/view';
import type { CampaignState } from '@/lib/ads/types';
import { applyCampaignChange } from './write-actions';

/**
 * Client-side ads table: search + sort (by spend, by ACOS) over the
 * server-fetched campaign rows, plus per-campaign wasted-spend flags.
 *
 * The parent server component does all the data fetching (campaigns + metrics +
 * the ACOS target) and hands the already-joined raw rows down as props; this
 * component owns only ephemeral view state (query, sort) and the derived display
 * values. ACOS/ROAS are COMPUTED here via lib/ads/metrics (divide-by-zero ->
 * null), flags via lib/ads/classify, and search/sort via lib/ads/view — so each
 * invariant (UNKNOWN never folds to 0) lives in one tested place, not here.
 *
 * Decision-support only: nothing here writes back to Amazon.
 */

export type AdsTableRow = {
  marketplace_id: string;
  campaign_id: string;
  name: string;
  state: CampaignState;
  daily_budget: number | null;
  cost: number | null;
  sales: number | null;
};

/** A row enriched with computed ACOS/ROAS + flags + recs, for sort + render. */
type DerivedRow = AdsTableRow & {
  acos: number | null;
  roas: number | null;
  flags: CampaignFlag[];
  recommendations: Recommendation[];
};

type SortMode = 'default' | 'spend-desc' | 'spend-asc' | 'acos-desc' | 'acos-asc';

const stateVariant: Record<string, 'default' | 'soon' | 'accent'> = {
  enabled: 'accent',
  paused: 'default',
  archived: 'soon',
};

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

/** A muted badge for any UNKNOWN cell (null metric, absent row, or null ratio). */
function UnknownCell({ title }: { title: string }) {
  return (
    <span title={title}>
      <Badge variant="soon">Unknown</Badge>
    </span>
  );
}

/** Per-flag label, hover explanation, and color. Distinct badge per flag. */
const flagMeta: Record<CampaignFlag, { label: string; title: string; className: string }> = {
  'high-acos': {
    label: 'High ACOS',
    title: 'Computed ACOS is above your target — spend is inefficient.',
    className: 'border-red-500/30 bg-red-500/10 text-red-600',
  },
  'spend-no-sales': {
    label: 'Spend, no sales',
    title: 'This campaign spent money but reported zero attributed sales.',
    className: 'border-red-500/30 bg-red-500/10 text-red-600',
  },
  underspending: {
    label: 'Underspending',
    title: 'An enabled campaign barely spending against its daily budget.',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
  },
};

function FlagBadge({ flag }: { flag: CampaignFlag }) {
  const meta = flagMeta[flag];
  return (
    <span title={meta.title}>
      <Badge className={meta.className}>{meta.label}</Badge>
    </span>
  );
}

const recKindLabel: Record<Recommendation['kind'], string> = {
  pause: 'Pause',
  'lower-budget': 'Lower budget',
  'raise-budget': 'Raise budget',
};

/** Read-only recommendation chips (shown to everyone, including staff). */
function Recommendations({ recs }: { recs: Recommendation[] }) {
  if (recs.length === 0) return <span className="text-xs text-faint">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {recs.map((rec) => (
        <span
          key={rec.kind}
          title={rec.reason}
          className="inline-flex w-fit items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent-strong"
        >
          {recKindLabel[rec.kind]}
          {rec.suggestedBudget !== undefined
            ? ` → ${formatCurrency(rec.suggestedBudget)}`
            : ''}
        </span>
      ))}
    </div>
  );
}

/**
 * Owner-only write-back controls for one campaign. Every write is a TWO-STEP
 * action: the first click arms a confirmation, the second executes — an explicit
 * confirmation gate before anything calls the (owner-gated, audited) server
 * action. Staff never see this component (the parent renders it only for owners).
 *
 * A budget pre-fill comes from a 'lower-budget' recommendation's suggestedBudget
 * when present, otherwise the current daily budget. The compare-to-current sets
 * the audit `kind` (lower vs raise) honestly.
 */
function CampaignActions({ row }: { row: DerivedRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | 'pause' | 'budget'>(null);

  const suggested = row.recommendations.find(
    (r) => r.kind === 'lower-budget' && r.suggestedBudget !== undefined,
  )?.suggestedBudget;
  const [budget, setBudget] = useState<string>(
    suggested !== undefined
      ? String(suggested)
      : row.daily_budget !== null
        ? String(row.daily_budget)
        : '',
  );

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        setConfirming(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Write failed.');
      }
    });
  }

  function doPause() {
    run(() =>
      applyCampaignChange({
        campaignId: row.campaign_id,
        marketplaceId: row.marketplace_id,
        kind: 'pause',
      }),
    );
  }

  function doBudget() {
    const value = Number(budget);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a positive budget.');
      return;
    }
    // Honest audit kind: a decrease vs the known current budget is 'lower-budget'.
    const kind =
      row.daily_budget !== null && value < row.daily_budget
        ? 'lower-budget'
        : 'raise-budget';
    run(() =>
      applyCampaignChange({
        campaignId: row.campaign_id,
        marketplaceId: row.marketplace_id,
        kind,
        dailyBudget: value,
      }),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Pause (only meaningful for an enabled campaign). */}
      {row.state === 'enabled' ? (
        confirming === 'pause' ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isPending}
              onClick={doPause}
              className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
            >
              {isPending ? 'Pausing…' : 'Confirm pause'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirming(null)}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              setConfirming('pause');
            }}
            className="w-fit rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-panel-muted disabled:opacity-50"
          >
            Pause
          </button>
        )
      ) : null}

      {/* Set daily budget. */}
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          step="0.01"
          value={budget}
          disabled={isPending}
          onChange={(e) => setBudget(e.target.value)}
          aria-label={`Set daily budget for ${row.name}`}
          className="w-20 rounded-md border border-border bg-panel px-2 py-1 text-[11px] tabular-nums text-foreground focus:border-accent focus:outline-none"
          placeholder="budget"
        />
        {confirming === 'budget' ? (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={doBudget}
              className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-foreground disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirming(null)}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              setConfirming('budget');
            }}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-panel-muted disabled:opacity-50"
          >
            Set budget
          </button>
        )}
      </div>

      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </div>
  );
}

export function AdsTable({
  rows,
  acosTarget,
  isOwner = false,
}: {
  rows: AdsTableRow[];
  /** ACOS target as a RATIO (0.25 = 25%); null = not set. Drives 'high-acos'. */
  acosTarget: number | null;
  /** Only owners get the write-back action controls; staff are read-only. */
  isOwner?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('default');

  // Enrich once: compute ACOS/ROAS and flags from the raw cost/sales. ACOS/ROAS
  // are null (UNKNOWN) on divide-by-zero; flags never trip on UNKNOWN data.
  const derived: DerivedRow[] = useMemo(
    () =>
      rows.map((row) => {
        const flags = classifyCampaign({
          state: row.state,
          cost: row.cost,
          sales: row.sales,
          dailyBudget: row.daily_budget,
          acosTarget,
        });
        return {
          ...row,
          acos: acos(row.cost, row.sales),
          roas: roas(row.sales, row.cost),
          flags,
          recommendations: recommendCampaignActions({
            state: row.state,
            cost: row.cost,
            sales: row.sales,
            dailyBudget: row.daily_budget,
            acosTarget,
            flags,
          }),
        };
      }),
    [rows, acosTarget],
  );

  const visibleRows = useMemo(() => {
    const filtered = searchCampaigns(derived, query);
    switch (sortMode) {
      case 'spend-desc':
        return sortBySpend(filtered, 'desc' as SortDirection);
      case 'spend-asc':
        return sortBySpend(filtered, 'asc' as SortDirection);
      case 'acos-desc':
        return sortByAcos(filtered, 'desc' as SortDirection);
      case 'acos-asc':
        return sortByAcos(filtered, 'asc' as SortDirection);
      default:
        return filtered;
    }
  }, [derived, query, sortMode]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or state…"
          aria-label="Search campaigns by name or state"
          className="w-64 rounded-md border border-border bg-panel px-3 py-1.5 text-sm text-foreground placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <label className="flex items-center gap-2 text-xs text-muted">
          <span>Sort</span>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            aria-label="Sort campaigns"
            className="rounded-md border border-border bg-panel px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="default">Name (default)</option>
            <option value="spend-desc">Spend: highest first</option>
            <option value="spend-asc">Spend: lowest first</option>
            <option value="acos-desc">ACOS: highest first</option>
            <option value="acos-asc">ACOS: lowest first</option>
          </select>
        </label>
      </div>

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
              <th className="px-4 py-3 font-medium">Flags</th>
              <th className="px-4 py-3 font-medium">Recommendations</th>
              {isOwner ? (
                <th className="px-4 py-3 font-medium">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={isOwner ? 10 : 9}
                  className="px-4 py-8 text-center text-sm text-muted"
                >
                  No campaigns match &ldquo;{query}&rdquo;.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
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
                    {row.daily_budget === null ? (
                      <UnknownCell title="Amazon did not report a budget - flagged for review" />
                    ) : (
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {formatCurrency(row.daily_budget)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.cost === null ? (
                      <UnknownCell title="No ad spend reported - flagged for review" />
                    ) : (
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {formatCurrency(row.cost)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.sales === null ? (
                      <UnknownCell title="No sales reported - flagged for review" />
                    ) : (
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {formatCurrency(row.sales)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.acos === null ? (
                      <UnknownCell title="ACOS is UNKNOWN (no sales or no spend data) - never shown as 0%" />
                    ) : (
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {formatAcos(row.acos)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.roas === null ? (
                      <UnknownCell title="ROAS is UNKNOWN (no spend or no sales data) - never shown as 0x" />
                    ) : (
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {formatRoas(row.roas)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.flags.length === 0 ? (
                      <span className="text-xs text-faint">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {row.flags.map((flag) => (
                          <FlagBadge key={flag} flag={flag} />
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Recommendations recs={row.recommendations} />
                  </td>
                  {isOwner ? (
                    <td className="px-4 py-3">
                      <CampaignActions row={row} />
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={isOwner ? 10 : 9}>
                <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
                  <span className="text-[11px] text-faint">
                    {visibleRows.length} of {rows.length} campaign
                    {rows.length === 1 ? '' : 's'}
                  </span>
                  <Badge className="border-border bg-panel-muted text-muted">US</Badge>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
