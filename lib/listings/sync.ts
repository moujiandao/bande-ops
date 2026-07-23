import type { AmazonClient } from '@/lib/amazon/client';
import { DEFAULT_MARKETPLACE, type Marketplace } from '@/lib/amazon/types';
import type { SyncWriter } from '@/lib/sync/run';
import { parseMerchantListings } from './parse';

export interface SyncMerchantListingsDeps {
  client: Pick<
    AmazonClient,
    'createMerchantListingsReport' | 'getReportUntilDone' | 'downloadReportDocument'
  >;
  admin: SyncWriter;
  marketplace?: Marketplace;
}

export interface SyncMerchantListingsResult {
  count: number;
  syncedAt: string;
  marketplaceId: string;
}

/**
 * Mirror listing metadata onto catalog_items.
 *
 * Writes to the same rows the catalog sync owns, adding what only the listings
 * report knows: open_date, listing status, and fulfillment channel. It also
 * carries asin/title, which fills in SKUs that Catalog Items search returns
 * nothing for — roughly a quarter of them in practice.
 */
export async function syncMerchantListings(
  deps: SyncMerchantListingsDeps,
): Promise<SyncMerchantListingsResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;

  const reportId = await deps.client.createMerchantListingsReport({ marketplace });
  const done = await deps.client.getReportUntilDone({ marketplace, reportId });
  const tsv = await deps.client.downloadReportDocument({
    marketplace,
    reportDocumentId: done.reportDocumentId,
  });

  const listings = parseMerchantListings(tsv);

  // A report that parses to nothing means the format moved under us. Fail loudly
  // instead of recording a healthy sync over an empty write.
  if (listings.length === 0) {
    throw new Error(
      'syncMerchantListings: report parsed to zero listings — the report format may have changed.',
    );
  }

  const syncedAt = new Date();
  const rows = listings.map((listing) => ({
    marketplace_id: marketplace.id,
    sku: listing.sku,
    asin: listing.asin,
    title: listing.title,
    open_date: listing.openDate,
    listing_status: listing.status,
    fulfillment_channel: listing.fulfillmentChannel,
    synced_at: syncedAt.toISOString(),
  }));

  const { error } = await deps.admin
    .from('catalog_items')
    .upsert(rows, { onConflict: 'marketplace_id,sku' });

  if (error) {
    throw new Error(`syncMerchantListings: mirror upsert failed: ${error.message}`);
  }

  return {
    count: rows.length,
    syncedAt: syncedAt.toISOString(),
    marketplaceId: marketplace.id,
  };
}
