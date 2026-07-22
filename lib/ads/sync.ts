import type { SyncWriter } from '@/lib/sync/run';
import type { AdsClient } from './client';
import { mapCampaignsToRows } from './mapping';
import { mapMetricsToRows } from './metrics-mapping';
import { DEFAULT_MARKETPLACE, type Marketplace } from './types';

/**
 * Orchestrates one ads sync: Amazon Advertising (source of truth) -> synced
 * mirror.
 *
 * Dependencies are injected (the AdsClient and a service-role Supabase client)
 * so this stays unit-testable with a FakeAdsClient + a mocked admin client — no
 * live network or DB. The real wiring lives in the server action
 * (`app/(app)/ads/actions.ts`), which is also why this file deliberately does
 * NOT `import 'server-only'` or touch the '@/lib/ads' barrel: importing either
 * would make the module unloadable in a node test. Note the client `AdsClient`
 * import is type-only (erased at compile), so no 'server-only' code is pulled.
 */

/** The slice of the admin client this orchestration actually uses. */
type AdsWriter = SyncWriter;

export interface SyncCampaignsDeps {
  /** Source of truth. In tests, a FakeAdsClient. */
  client: Pick<AdsClient, 'listCampaigns'>;
  /** Service-role Supabase client (bypasses RLS) for the mirror write. */
  admin: AdsWriter;
  /** Marketplace to sync. Defaults to US. */
  marketplace?: Marketplace;
}

export interface SyncCampaignsResult {
  /** Number of rows upserted. */
  count: number;
  /** Shared sync timestamp (ISO-8601) stamped on every row. */
  syncedAt: string;
  marketplaceId: string;
}

/**
 * Fetch campaigns from the Advertising API, map to mirror rows, and UPSERT them
 * on conflict (marketplace_id, campaign_id), refreshing
 * name/state/daily_budget/synced_at.
 *
 * Idempotent: running it twice with the same Amazon data converges the mirror
 * to the same set of rows (the upsert overwrites by primary key), it does not
 * duplicate.
 */
export async function syncCampaigns(
  deps: SyncCampaignsDeps,
): Promise<SyncCampaignsResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;

  const campaigns = await deps.client.listCampaigns();

  // One timestamp for the whole batch.
  const syncedAt = new Date();
  const rows = mapCampaignsToRows(campaigns, {
    marketplaceId: marketplace.id,
    syncedAt,
  });

  const { error } = await deps.admin
    .from('ads_campaigns')
    .upsert(rows, { onConflict: 'marketplace_id,campaign_id' });

  if (error) {
    throw new Error(`syncCampaigns: mirror upsert failed: ${error.message}`);
  }

  return {
    count: rows.length,
    syncedAt: syncedAt.toISOString(),
    marketplaceId: marketplace.id,
  };
}

export interface SyncCampaignMetricsDeps {
  /** Source of truth. In tests, a FakeAdsClient. */
  client: Pick<AdsClient, 'getCampaignMetrics'>;
  /** Service-role Supabase client (bypasses RLS) for the mirror write. */
  admin: AdsWriter;
  /** Marketplace to sync. Defaults to US. */
  marketplace?: Marketplace;
}

/**
 * Fetch campaign performance metrics (ONE batched async report, all campaigns)
 * from the Advertising API, map to mirror rows, and UPSERT them on conflict
 * (marketplace_id, campaign_id), refreshing impressions/clicks/cost/sales and
 * synced_at.
 *
 * UNKNOWN invariant: null metrics flow through untouched (never 0). ACOS/ROAS
 * are intentionally NOT stored — they are computed at render time from
 * cost/sales (see metrics.ts).
 *
 * Idempotent: re-running with the same Amazon data converges the mirror to the
 * same row set (upsert overwrites by primary key), it does not duplicate.
 */
export async function syncCampaignMetrics(
  deps: SyncCampaignMetricsDeps,
): Promise<SyncCampaignsResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;

  const metrics = await deps.client.getCampaignMetrics();

  // One timestamp for the whole batch.
  const syncedAt = new Date();
  const rows = mapMetricsToRows(metrics, {
    marketplaceId: marketplace.id,
    syncedAt,
  });

  const { error } = await deps.admin
    .from('ads_campaign_metrics')
    .upsert(rows, { onConflict: 'marketplace_id,campaign_id' });

  if (error) {
    throw new Error(
      `syncCampaignMetrics: mirror upsert failed: ${error.message}`,
    );
  }

  return {
    count: rows.length,
    syncedAt: syncedAt.toISOString(),
    marketplaceId: marketplace.id,
  };
}
