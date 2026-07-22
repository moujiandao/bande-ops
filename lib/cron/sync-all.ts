import { syncCatalog, type SyncCatalogDeps } from '@/lib/catalog/sync';
import { syncAwdInventory, type SyncAwdInventoryDeps } from '@/lib/awd/sync';
import { syncInventory, type SyncInventoryDeps } from '@/lib/inventory/sync';
import {
  syncFbaLedgerVelocity,
  type SyncFbaLedgerVelocityDeps,
} from '@/lib/velocity/sync';
import {
  syncCampaigns,
  syncCampaignMetrics,
  type SyncCampaignsDeps,
  type SyncCampaignMetricsDeps,
} from '@/lib/ads/sync';

/**
 * Single orchestration for the scheduled full sync: refresh ALL synced mirrors
 * (catalog + FBA inventory + AWD inventory + sales velocity from SP-API,
 * campaigns + campaign metrics from the Advertising API) from one entry point.
 *
 * This is the scheduled counterpart to the manual page actions — the catalog
 * page's "Sync now" and the /ads "Sync now" (`syncAdsAction`) — collapsed into
 * one call so a single cron tick refreshes everything. The cron route is a thin
 * adapter that wires the real clients (`getAmazonClient()`, `getAdsClient()`,
 * `createAdminClient()`) into this function.
 *
 * Dependencies are injected (the two source clients + a service-role Supabase
 * client) so this stays unit-testable with FakeAmazonClient + FakeAdsClient + a
 * mocked admin client — no live network or DB. Like the per-module sync modules
 * it composes, this file deliberately does NOT `import 'server-only'` or touch
 * the `@/lib/amazon` / `@/lib/ads` / `@/lib/supabase/admin` barrels: importing
 * any of those would pull `server-only` and make the module unloadable in a node
 * test. The sync-function imports are value imports, but those modules are
 * themselves server-only-free by the same discipline.
 */

/**
 * The Amazon (SP-API) client surface the full sync needs — the union of what
 * catalog and inventory each require. Reusing the per-sync `Pick`s keeps this in
 * lockstep with them: widen a sub-sync's needs and this widens automatically.
 */
type FullSyncAmazonClient = SyncCatalogDeps['client'] &
  SyncInventoryDeps['client'] &
  SyncAwdInventoryDeps['client'] &
  SyncFbaLedgerVelocityDeps['client'];

/** The Advertising client surface the full sync needs (campaigns + metrics). */
type FullSyncAdsClient = SyncCampaignsDeps['client'] &
  SyncCampaignMetricsDeps['client'];

/**
 * Service-role Supabase client slice used by every mirror write.
 *
 * Unlike the client surfaces above, this is NOT an intersection of the
 * per-sync `admin` types. All six syncs deliberately declare the same
 * structural `SyncWriter` seam, so one member covers them all. That is
 * load-bearing: each extra intersection member makes TypeScript re-instantiate
 * Supabase's generic `from()` when the real client is passed in at
 * `app/api/cron/sync/route.ts`, and four members exceeds the
 * instantiation-depth limit that `next build` type-checks against.
 */
type FullSyncWriter = SyncCatalogDeps['admin'];

export interface RunFullSyncDeps {
  /** SP-API source of truth (catalog + inventory). FakeAmazonClient in tests. */
  amazonClient: FullSyncAmazonClient;
  /** Advertising source of truth (campaigns + metrics). FakeAdsClient in tests. */
  adsClient: FullSyncAdsClient;
  /** Service-role Supabase client (bypasses RLS) for the mirror writes. */
  admin: FullSyncWriter;
}

export interface FullSyncCounts {
  /** Catalog mirror rows upserted. */
  catalog: number;
  /** Inventory mirror rows upserted. */
  inventory: number;
  /** AWD inventory mirror rows upserted. */
  awdInventory: number;
  /** FBA ledger daily rows upserted. */
  fbaLedgerRows: number;
  /** Sales velocity rows upserted. */
  salesVelocity: number;
  /** Ads campaign mirror rows upserted. */
  adsCampaigns: number;
  /** Ads campaign-metrics mirror rows upserted. */
  adsCampaignMetrics: number;
}

/**
 * Run every mirror sync and return the per-mirror upsert counts.
 *
 * Sequential by design: a cron tick is not latency-sensitive, and running the
 * syncs in order keeps error attribution clear (the first failing sync throws
 * and aborts the rest, rather than a Promise.all surfacing an opaque rejection).
 * Campaigns run before campaign metrics, mirroring `syncAdsAction` (metrics join
 * to the campaign list by natural key).
 *
 * Marketplace is intentionally not a parameter: each sub-sync defaults to US,
 * matching the manual actions and the prior cron behavior.
 */
export async function runFullSync(
  deps: RunFullSyncDeps,
): Promise<FullSyncCounts> {
  const { amazonClient, adsClient, admin } = deps;

  const catalog = await syncCatalog({ client: amazonClient, admin });
  const inventory = await syncInventory({ client: amazonClient, admin });
  const awdInventory = await syncAwdInventory({ client: amazonClient, admin });
  const velocity = await syncFbaLedgerVelocity({
    client: amazonClient,
    admin,
  });
  const adsCampaigns = await syncCampaigns({ client: adsClient, admin });
  const adsCampaignMetrics = await syncCampaignMetrics({
    client: adsClient,
    admin,
  });

  return {
    catalog: catalog.count,
    inventory: inventory.count,
    awdInventory: awdInventory.count,
    fbaLedgerRows: velocity.ledgerRows,
    salesVelocity: velocity.velocityRows,
    adsCampaigns: adsCampaigns.count,
    adsCampaignMetrics: adsCampaignMetrics.count,
  };
}
