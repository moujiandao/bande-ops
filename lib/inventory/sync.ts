import type { SupabaseClient } from '@supabase/supabase-js';
import type { AmazonClient } from '@/lib/amazon/client';
import { DEFAULT_MARKETPLACE, type Marketplace } from '@/lib/amazon/types';
import { mapInventorySummariesToRows } from './mapping';

/**
 * Orchestrates one inventory sync: Amazon (source of truth) -> synced mirror.
 *
 * Mirror of `syncCatalog`. Dependencies are injected (the AmazonClient and a
 * service-role Supabase client) so this stays unit-testable with a
 * FakeAmazonClient + a mocked admin client — no live network or DB. The real
 * wiring lives in the server action (`app/(app)/catalog/actions.ts`), which is
 * also why this file deliberately does NOT `import 'server-only'` or touch the
 * '@/lib/amazon' barrel: importing either would make the module unloadable in a
 * node test.
 */

/** The slice of the admin client this orchestration actually uses. */
type InventoryWriter = Pick<SupabaseClient, 'from'>;

export interface SyncInventoryDeps {
  /** Source of truth. In tests, a FakeAmazonClient. */
  client: Pick<AmazonClient, 'getInventorySummaries'>;
  /** Service-role Supabase client (bypasses RLS) for the mirror write. */
  admin: InventoryWriter;
  /** Marketplace to sync. Defaults to US. */
  marketplace?: Marketplace;
}

export interface SyncInventoryResult {
  /** Number of rows upserted. */
  count: number;
  /** Shared sync timestamp (ISO-8601) stamped on every row. */
  syncedAt: string;
  marketplaceId: string;
}

/**
 * Fetch inventory from Amazon, map to mirror rows, and UPSERT them on conflict
 * (marketplace_id, sku), refreshing total_quantity/fn_sku/synced_at.
 *
 * Preserves the UNKNOWN-stock rule: a null totalQuantity is written as NULL,
 * never 0. Idempotent: running it twice with the same Amazon data converges the
 * mirror to the same set of rows (the upsert overwrites by primary key), it
 * does not duplicate.
 */
export async function syncInventory(
  deps: SyncInventoryDeps,
): Promise<SyncInventoryResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;

  const summaries = await deps.client.getInventorySummaries({ marketplace });

  // One timestamp for the whole batch.
  const syncedAt = new Date();
  const rows = mapInventorySummariesToRows(summaries, {
    marketplaceId: marketplace.id,
    syncedAt,
  });

  const { error } = await deps.admin
    .from('inventory_levels')
    .upsert(rows, { onConflict: 'marketplace_id,sku' });

  if (error) {
    throw new Error(`syncInventory: mirror upsert failed: ${error.message}`);
  }

  return {
    count: rows.length,
    syncedAt: syncedAt.toISOString(),
    marketplaceId: marketplace.id,
  };
}
