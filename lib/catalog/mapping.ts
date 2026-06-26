import { DEFAULT_MARKETPLACE, type CatalogItem } from '@/lib/amazon/types';

/**
 * A row of the `public.catalog_items` synced mirror, exactly as written to
 * Postgres. snake_case to match the column names; `image_url` is nullable;
 * `synced_at` is an ISO-8601 string.
 *
 * NOTE: import the marketplace constant from '@/lib/amazon/types' (not the
 * '@/lib/amazon' barrel) — the barrel pulls SpApiClient -> 'server-only', which
 * would make this pure module unimportable from a unit test.
 */
export interface CatalogItemRow {
  marketplace_id: string;
  sku: string;
  asin: string;
  title: string;
  image_url: string | null;
  synced_at: string;
}

export interface MapCatalogOptions {
  /** Marketplace this row belongs to. Defaults to US. */
  marketplaceId?: string;
  /** Sync timestamp stamped onto the row. Defaults to now. */
  syncedAt?: Date;
}

/**
 * Pure `CatalogItem -> catalog_items row` mapping.
 *
 * No DB, no network, no hidden clock unless you let it default `syncedAt` —
 * pass a fixed `syncedAt` in tests for determinism. We set `synced_at`
 * explicitly (rather than leaning on the DB default) so an UPSERT refreshes it
 * on conflict; a column default only fires on INSERT.
 */
export function mapCatalogItemToRow(
  item: CatalogItem,
  opts: MapCatalogOptions = {},
): CatalogItemRow {
  const marketplaceId = opts.marketplaceId ?? DEFAULT_MARKETPLACE.id;
  const syncedAt = opts.syncedAt ?? new Date();

  return {
    marketplace_id: marketplaceId,
    sku: item.sku,
    asin: item.asin,
    title: item.title,
    image_url: item.imageUrl ?? null,
    synced_at: syncedAt.toISOString(),
  };
}

/** Map a batch of catalog items, stamping every row with the same timestamp. */
export function mapCatalogItemsToRows(
  items: CatalogItem[],
  opts: MapCatalogOptions = {},
): CatalogItemRow[] {
  // Resolve `syncedAt` once so every row in a single sync shares one timestamp.
  const syncedAt = opts.syncedAt ?? new Date();
  return items.map((item) =>
    mapCatalogItemToRow(item, { ...opts, syncedAt }),
  );
}
