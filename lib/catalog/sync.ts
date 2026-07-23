import type { AmazonClient } from '@/lib/amazon/client';
import type { SyncWriter } from '@/lib/sync/run';
import { DEFAULT_MARKETPLACE, type Marketplace } from '@/lib/amazon/types';
import { mapCatalogItemsToRows } from './mapping';

/**
 * Orchestrates one catalog sync: Amazon (source of truth) -> synced mirror.
 *
 * Dependencies are injected (the AmazonClient and a service-role Supabase
 * client) so this stays unit-testable with a FakeAmazonClient + a mocked admin
 * client — no live network or DB. The real wiring lives in the server action
 * (`app/(app)/catalog/actions.ts`), which is also why this file deliberately
 * does NOT `import 'server-only'` or touch the '@/lib/amazon' barrel: importing
 * either would make the module unloadable in a node test.
 */

/**
 * The slice of the admin client this orchestration actually uses.
 *
 * Deliberately the shared structural `SyncWriter` rather than
 * `Pick<SupabaseClient, 'from'>`. Every sync module declares this same narrow
 * write seam, which lets `runFullSync` type its single `admin` dep as one of
 * them instead of intersecting several — each intersection member would make
 * TypeScript re-instantiate Supabase's generic, heavily-overloaded `from()`
 * at the cron call site, exceeding the instantiation-depth limit.
 */
type CatalogWriter = SyncWriter;

export interface SyncCatalogDeps {
  /** Source of truth. In tests, a FakeAmazonClient. */
  client: Pick<AmazonClient, 'listCatalogItems' | 'getInventorySummaries'>;
  /** Service-role Supabase client (bypasses RLS) for the mirror write. */
  admin: CatalogWriter;
  /** Marketplace to sync. Defaults to US. */
  marketplace?: Marketplace;
}

export interface SyncCatalogResult {
  /** Number of rows upserted. */
  count: number;
  /** Shared sync timestamp (ISO-8601) stamped on every row. */
  syncedAt: string;
  marketplaceId: string;
}

/**
 * Fetch the catalog from Amazon, map to mirror rows, and UPSERT them on
 * conflict (marketplace_id, sku), refreshing asin/title/image_url/synced_at.
 *
 * Idempotent: running it twice with the same Amazon data converges the mirror
 * to the same set of rows (the upsert overwrites by primary key), it does not
 * duplicate.
 */
export async function syncCatalog(
  deps: SyncCatalogDeps,
): Promise<SyncCatalogResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;

  // Catalog Items (2022-04-01) is a search API and cannot enumerate a seller's
  // products, so FBA inventory supplies the SKU universe and catalog only
  // enriches it. A SKU never sent into FBA will not appear here by design.
  const summaries = await deps.client.getInventorySummaries({ marketplace });
  const skus = [...new Set(summaries.map((s) => s.sku).filter(Boolean))];

  // One timestamp for the whole batch.
  const syncedAt = new Date();

  if (skus.length === 0) {
    return {
      count: 0,
      syncedAt: syncedAt.toISOString(),
      marketplaceId: marketplace.id,
    };
  }

  const items = await deps.client.listCatalogItems({
    marketplace,
    sellerSkus: skus,
  });

  // Amazon returns catalog data for only some SKUs. Keep a row for every SKU
  // we know we stock — dropping the misses would silently remove them from
  // /reorder rather than surfacing them for review.
  const bySku = new Map(items.map((item) => [item.sku, item]));
  const complete = skus.map(
    (sku) => bySku.get(sku) ?? { sku, asin: '', title: '' },
  );

  const rows = mapCatalogItemsToRows(complete, {
    marketplaceId: marketplace.id,
    syncedAt,
  });

  const { error } = await deps.admin
    .from('catalog_items')
    .upsert(rows, { onConflict: 'marketplace_id,sku' });

  if (error) {
    throw new Error(`syncCatalog: mirror upsert failed: ${error.message}`);
  }

  return {
    count: rows.length,
    syncedAt: syncedAt.toISOString(),
    marketplaceId: marketplace.id,
  };
}
