import { DEFAULT_MARKETPLACE, type InventorySummary } from '@/lib/amazon/types';

/**
 * A row of the `public.inventory_levels` synced mirror, exactly as written to
 * Postgres. snake_case to match the column names; `total_quantity` and `fn_sku`
 * are nullable; `synced_at` is an ISO-8601 string.
 *
 * UNKNOWN-stock rule: `total_quantity` is `number | null`. null means Amazon
 * reported the quantity as non-numeric/unavailable (UNKNOWN) — it is NOT 0 and
 * must never be coalesced to 0 anywhere in the pipeline.
 *
 * NOTE: import the marketplace constant from '@/lib/amazon/types' (not the
 * '@/lib/amazon' barrel) — the barrel pulls SpApiClient -> 'server-only', which
 * would make this pure module unimportable from a unit test.
 */
export interface InventoryLevelRow {
  marketplace_id: string;
  sku: string;
  total_quantity: number | null;
  fn_sku: string | null;
  fulfillable_quantity: number | null;
  inbound_working_quantity: number | null;
  inbound_shipped_quantity: number | null;
  inbound_receiving_quantity: number | null;
  reserved_quantity: number | null;
  researching_quantity: number | null;
  unfulfillable_quantity: number | null;
  synced_at: string;
  sync_run_id: string | null;
}

export interface MapInventoryOptions {
  /** Marketplace this row belongs to. Defaults to the summary's, then US. */
  marketplaceId?: string;
  /** Sync timestamp stamped onto the row. Defaults to now. */
  syncedAt?: Date;
  /** Source-sync run that produced this row. */
  syncRunId?: string;
}

/**
 * Pure `InventorySummary -> inventory_levels row` mapping.
 *
 * Preserves the UNKNOWN-stock convention end to end: a null `totalQuantity`
 * stays null in `total_quantity` — it is never folded to 0. No DB, no network,
 * no hidden clock unless you let it default `syncedAt`; pass a fixed `syncedAt`
 * in tests for determinism. We set `synced_at` explicitly (rather than leaning
 * on the DB default) so an UPSERT refreshes it on conflict; a column default
 * only fires on INSERT.
 */
export function mapInventorySummaryToRow(
  summary: InventorySummary,
  opts: MapInventoryOptions = {},
): InventoryLevelRow {
  const marketplaceId =
    opts.marketplaceId ?? summary.marketplaceId ?? DEFAULT_MARKETPLACE.id;
  const syncedAt = opts.syncedAt ?? new Date();

  return {
    marketplace_id: marketplaceId,
    sku: summary.sku,
    // Deliberately NOT `?? 0`: null (UNKNOWN) must survive as null.
    total_quantity: summary.totalQuantity,
    fn_sku: summary.fnSku ?? null,
    fulfillable_quantity: summary.fulfillableQuantity ?? null,
    inbound_working_quantity: summary.inboundWorkingQuantity ?? null,
    inbound_shipped_quantity: summary.inboundShippedQuantity ?? null,
    inbound_receiving_quantity: summary.inboundReceivingQuantity ?? null,
    reserved_quantity: summary.reservedQuantity ?? null,
    researching_quantity: summary.researchingQuantity ?? null,
    unfulfillable_quantity: summary.unfulfillableQuantity ?? null,
    synced_at: syncedAt.toISOString(),
    sync_run_id: opts.syncRunId ?? null,
  };
}

/** Map a batch of summaries, stamping every row with the same timestamp. */
export function mapInventorySummariesToRows(
  summaries: InventorySummary[],
  opts: MapInventoryOptions = {},
): InventoryLevelRow[] {
  // Resolve `syncedAt` once so every row in a single sync shares one timestamp.
  const syncedAt = opts.syncedAt ?? new Date();
  return summaries.map((summary) =>
    mapInventorySummaryToRow(summary, { ...opts, syncedAt }),
  );
}
