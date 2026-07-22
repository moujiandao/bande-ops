import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';
import {
  recordSyncAttempt,
  recordSyncFailure,
  recordSyncSuccess,
  type SyncTable,
} from '@/lib/sync/run';
import type { SvdClient } from './client';
import { parseSvdInventoryHtml } from './parse';

export interface RefreshSvdInventoryDeps {
  admin: SvdWriter;
  client: Pick<SvdClient, 'fetchInventoryHtml'>;
}

type SvdTable = SyncTable & {
  delete(): {
    or(filters: string): PromiseLike<{ error: { message: string } | null }>;
  };
};

type SvdWriter = {
  from(table: string): SvdTable;
};

export async function refreshSvdInventory(
  deps: RefreshSvdInventoryDeps,
): Promise<{ count: number; syncRunId: string }> {
  const marketplaceId = DEFAULT_MARKETPLACE.id;
  const syncRunId = await recordSyncAttempt({
    admin: deps.admin,
    source: 'svd_inventory',
    marketplaceId,
  });

  try {
    const html = await deps.client.fetchInventoryHtml();
    const items = parseSvdInventoryHtml(html);
    if (items.length === 0) {
      throw new Error('SVD inventory parse returned zero rows.');
    }

    const refreshedAt = new Date().toISOString();
    const rows = items.map((item) => ({
      svd_item_id: item.svdItemId,
      sku: item.sku ?? null,
      fn_sku: item.fnSku ?? null,
      description: item.description,
      quantity: item.quantity,
      raw_availability: item.rawAvailability,
      refreshed_at: refreshedAt,
      sync_run_id: syncRunId,
    }));

    const { error } = await deps.admin
      .from('svd_inventory_levels')
      .upsert(rows, { onConflict: 'svd_item_id' });
    if (error) {
      throw new Error(`refreshSvdInventory: upsert failed: ${error.message}`);
    }

    const { error: deleteError } = await deps.admin
      .from('svd_inventory_levels')
      .delete()
      .or(`sync_run_id.is.null,sync_run_id.neq.${syncRunId}`);
    if (deleteError) {
      throw new Error(
        `refreshSvdInventory: stale snapshot cleanup failed: ${deleteError.message}`,
      );
    }

    await recordSyncSuccess({
      admin: deps.admin,
      source: 'svd_inventory',
      marketplaceId,
      syncRunId,
      rowCount: rows.length,
    });

    return { count: rows.length, syncRunId };
  } catch (error) {
    await recordSyncFailure({
      admin: deps.admin,
      source: 'svd_inventory',
      marketplaceId,
      syncRunId,
      error,
    });
    throw error;
  }
}
