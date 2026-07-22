import type { AmazonClient } from '@/lib/amazon/client';
import { DEFAULT_MARKETPLACE, type Marketplace } from '@/lib/amazon/types';
import {
  recordSyncAttempt,
  recordSyncFailure,
  recordSyncSuccess,
  type SyncWriter,
} from '@/lib/sync/run';
import { mapAwdInventoryToRows } from './mapping';

export interface SyncAwdInventoryDeps {
  client: Pick<AmazonClient, 'listAwdInventory'>;
  admin: SyncWriter;
  marketplace?: Marketplace;
}

export interface SyncAwdInventoryResult {
  count: number;
  syncedAt: string;
  marketplaceId: string;
  syncRunId: string;
}

/** Sync the AWD source-of-truth mirror without blending it into FBA stock. */
export async function syncAwdInventory(
  deps: SyncAwdInventoryDeps,
): Promise<SyncAwdInventoryResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;
  const syncRunId = await recordSyncAttempt({
    admin: deps.admin,
    source: 'awd_inventory',
    marketplaceId: marketplace.id,
  });

  try {
    const summaries = await deps.client.listAwdInventory({ marketplace });
    const syncedAt = new Date();
    const rows = mapAwdInventoryToRows(summaries, { syncedAt, syncRunId });
    const { error } = await deps.admin
      .from('awd_inventory_levels')
      .upsert(rows, { onConflict: 'marketplace_id,sku' });

    if (error) {
      throw new Error(`syncAwdInventory: mirror upsert failed: ${error.message}`);
    }

    await recordSyncSuccess({
      admin: deps.admin,
      source: 'awd_inventory',
      marketplaceId: marketplace.id,
      syncRunId,
      rowCount: rows.length,
    });

    return {
      count: rows.length,
      syncedAt: syncedAt.toISOString(),
      marketplaceId: marketplace.id,
      syncRunId,
    };
  } catch (error) {
    await recordSyncFailure({
      admin: deps.admin,
      source: 'awd_inventory',
      marketplaceId: marketplace.id,
      syncRunId,
      error,
    });
    throw error;
  }
}
