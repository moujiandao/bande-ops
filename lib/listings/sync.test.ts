import { describe, expect, it, vi } from 'vitest';
import { syncMerchantListings, type SyncMerchantListingsDeps } from './sync';

function makeAdminMock() {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn().mockReturnValue({ upsert });
  return {
    admin: { from } as unknown as SyncMerchantListingsDeps['admin'],
    from,
    upsert,
  };
}

const HEADER = '﻿item-name\tseller-sku\topen-date\tasin1\tfulfillment-channel\tstatus';

function client(tsv: string) {
  return {
    createMerchantListingsReport: vi.fn().mockResolvedValue('report-1'),
    getReportUntilDone: vi
      .fn()
      .mockResolvedValue({ reportId: 'report-1', reportDocumentId: 'doc-1' }),
    downloadReportDocument: vi.fn().mockResolvedValue(tsv),
  };
}

describe('syncMerchantListings', () => {
  it('upserts listing metadata keyed on marketplace + sku', async () => {
    const { admin, from, upsert } = makeAdminMock();
    const tsv = [
      HEADER,
      'A Product\tsku-a\t2022-05-31 17:21:53 PDT\tB01\tAMAZON_NA\tActive',
    ].join('\n');

    const result = await syncMerchantListings({ client: client(tsv) as never, admin });

    expect(from).toHaveBeenCalledWith('catalog_items');
    const [rows, options] = upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: 'marketplace_id,sku' });
    expect(rows[0]).toMatchObject({
      sku: 'sku-a',
      open_date: '2022-05-31',
      listing_status: 'Active',
      fulfillment_channel: 'AMAZON_NA',
      asin: 'B01',
      title: 'A Product',
    });
    expect(result.count).toBe(1);
  });

  it('throws rather than writing nothing when the report parses to zero rows', async () => {
    // A silently empty parse is the failure mode that made the ledger sync
    // report success while writing no data.
    const { admin } = makeAdminMock();

    await expect(
      syncMerchantListings({ client: client(HEADER) as never, admin }),
    ).rejects.toThrow(/zero listings/i);
  });
});
