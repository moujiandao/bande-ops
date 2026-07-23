import type { AwdInventorySummary } from '@/lib/amazon/types';

export interface AwdInventoryLevelRow {
  marketplace_id: string;
  sku: string;
  fn_sku: string | null;
  replenishment_quantity: number | null;
  available_distributable_quantity: number | null;
  total_quantity: number | null;
  inbound_quantity: number | null;
  synced_at: string;
  sync_run_id: string | null;
}

export interface MapAwdInventoryOptions {
  syncedAt?: Date;
  syncRunId?: string;
}

export function mapAwdInventoryToRows(
  summaries: AwdInventorySummary[],
  opts: MapAwdInventoryOptions = {},
): AwdInventoryLevelRow[] {
  const syncedAt = opts.syncedAt ?? new Date();
  return summaries.map((summary) => ({
    marketplace_id: summary.marketplaceId,
    sku: summary.sku,
    fn_sku: summary.fnSku ?? null,
    replenishment_quantity: summary.replenishmentQuantity,
    available_distributable_quantity: summary.availableDistributableQuantity,
    total_quantity: summary.totalQuantity,
    inbound_quantity: summary.inboundQuantity,
    synced_at: syncedAt.toISOString(),
    sync_run_id: opts.syncRunId ?? null,
  }));
}
