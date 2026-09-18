import { archivedSkuKeys, isSkuArchived } from '@/lib/archive/skus';
import {
  analyticsSourceIssue,
  buildSalesAnalytics,
  momentumSignalsBySku,
  readAnalyticsHistory,
} from '@/lib/analytics/service';
import { createClient } from '@/lib/supabase/server';
import { readAnalyticsSettings, vineAdjustmentIssue } from '@/lib/analytics/settings';
import { readShipmentAdjustments } from '@/lib/shipments/read';
import { shouldReplenishFromSvd } from './replenish';
import { assembleRecommendations } from './service';

function reorderQty(
  row: Awaited<ReturnType<typeof assembleRecommendations>>['rows'][number],
): number {
  return row.recommendation.status === 'ok' ? row.recommendation.recommendedQty : 0;
}

/**
 * A transfer is safe only when the full recommendation has passed its source
 * checks. Transfer math can produce a number from partial mirrors, but a stale
 * or missing source must remain in review instead of becoming an action item.
 */
export function transferCandidates(
  rows: Awaited<ReturnType<typeof assembleRecommendations>>['rows'],
  svdToFbaTargetDays: number,
) {
  return rows.filter(
    (row) =>
      row.recommendation.status === 'ok' &&
      shouldReplenishFromSvd(row, svdToFbaTargetDays),
  );
}

/**
 * The shared server-side data boundary for the two inventory-planning routes.
 * Both workflows make different decisions from the same synced mirrors, so they
 * must apply the same archive, source-health, and analytics safety rules.
 */
export async function loadReorderWorkflowData() {
  const supabase = await createClient();
  const [recommendations, analyticsHistory, archivedRes, analyticsSettings] = await Promise.all([
    assembleRecommendations({ supabase }),
    readAnalyticsHistory({ supabase, historyDays: 90 }),
    supabase.from('archived_skus').select('marketplace_id, sku'),
    readAnalyticsSettings(supabase),
  ]);
  const { rows: sourceRows, errors, sourceHealth, policy } = recommendations;
  const archivedKeys = archivedSkuKeys(archivedRes.data ?? []);
  const rows = archivedRes.error
    ? []
    : sourceRows.filter(
        (row) => !isSkuArchived(archivedKeys, row.marketplaceId, row.sku),
      );
  const adjustment = analyticsSettings.excludeVine ? await readShipmentAdjustments({
    supabase, startDate: analyticsHistory.rows[0]?.activity_date ?? null,
    endDate: analyticsHistory.dataThroughDate,
  }) : undefined;
  const analyticsIssue = vineAdjustmentIssue(analyticsSettings, adjustment) ?? analyticsSourceIssue(sourceHealth);
  const analytics = analyticsHistory.error || analyticsIssue
    ? []
    : buildSalesAnalytics({
        products: rows,
        ledgerRows: analyticsHistory.rows,
        windowDays: 7,
        historyDays: 90,
        dataThroughDate: analyticsHistory.dataThroughDate,
        excludeVine: analyticsSettings.excludeVine === true,
        adjustmentRows: adjustment?.rows,
        adjustmentThroughDate: adjustment?.throughDate,
      });
  const momentumBySku = analyticsHistory.error || analyticsIssue
    ? undefined
    : momentumSignalsBySku(analytics);
  const active = rows.filter((row) => !row.isLegacy);
  const legacy = rows.filter((row) => row.isLegacy);
  const svdToFbaTargetDays = policy.svdToFbaTargetDays;
  const replenishFromSvd = transferCandidates(active, svdToFbaTargetDays);
  const toReorder = active
    .filter((row) => row.recommendation.status === 'ok' && reorderQty(row) > 0)
    .sort((a, b) => reorderQty(b) - reorderQty(a));

  return {
    sourceRows,
    rows,
    sourceHealth,
    loadErrors: Object.entries(errors).filter(([, message]) => Boolean(message)),
    archiveError: archivedRes.error?.message ?? null,
    analyticsError: analyticsHistory.error ?? analyticsIssue ?? null,
    analyticsSettings,
    momentumBySku,
    policy,
    active,
    legacy,
    replenishFromSvd,
    toReorder,
    needsReview: active.filter((row) => row.recommendation.status === 'needs-review'),
    wellStocked: active.filter(
      (row) => row.recommendation.status === 'ok' && reorderQty(row) === 0,
    ),
    trendingCount: toReorder.filter((row) => {
      const kind = momentumBySku?.[row.sku]?.kind;
      return kind === 'trending-up' || kind === 'sustained-growth';
    }).length,
  };
}
