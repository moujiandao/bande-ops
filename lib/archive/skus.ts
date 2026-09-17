export interface ArchivedSkuRow {
  marketplace_id: string;
  sku: string;
  archived_at: string;
  archived_by: string | null;
}

export function archivedSkuKey(marketplaceId: string, sku: string): string {
  return `${marketplaceId}:${sku}`;
}

export function archivedSkuKeys(
  rows: Pick<ArchivedSkuRow, 'marketplace_id' | 'sku'>[],
): Set<string> {
  return new Set(
    rows.map((row) => archivedSkuKey(row.marketplace_id, row.sku)),
  );
}

export function isSkuArchived(
  keys: ReadonlySet<string>,
  marketplaceId: string,
  sku: string,
): boolean {
  return keys.has(archivedSkuKey(marketplaceId, sku));
}
