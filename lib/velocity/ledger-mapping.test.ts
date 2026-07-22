import { describe, expect, it } from 'vitest';
import { normalizeLedgerRows } from './ledger-mapping';

describe('normalizeLedgerRows', () => {
  it('keeps only sellable rows and derives in-stock from sellable ending balance', () => {
    const tsv = [
      'Date\tFNSKU\tMSKU\tDisposition\tCustomer Shipments\tEnding Warehouse Balance',
      '2026-07-21\tFNSKU-1\tSKU-1\tSELLABLE\t3\t7',
      '2026-07-20\tFNSKU-1\tSKU-1\tSELLABLE\t0\t0',
      '2026-07-20\tFNSKU-1\tSKU-1\tUNSELLABLE\t9\t20',
    ].join('\n');

    expect(
      normalizeLedgerRows(tsv, {
        marketplaceId: 'ATVPDKIKX0DER',
        reportId: 'report-1',
        syncRunId: 'run-1',
      }),
    ).toEqual([
      {
        marketplace_id: 'ATVPDKIKX0DER',
        sku: 'SKU-1',
        fn_sku: 'FNSKU-1',
        activity_date: '2026-07-21',
        customer_shipments: 3,
        sellable_ending_balance: 7,
        is_in_stock: true,
        report_id: 'report-1',
        sync_run_id: 'run-1',
      },
      {
        marketplace_id: 'ATVPDKIKX0DER',
        sku: 'SKU-1',
        fn_sku: 'FNSKU-1',
        activity_date: '2026-07-20',
        customer_shipments: 0,
        sellable_ending_balance: 0,
        is_in_stock: false,
        report_id: 'report-1',
        sync_run_id: 'run-1',
      },
    ]);
  });

  it('skips sellable rows without an MSKU', () => {
    const tsv = [
      'Date\tFNSKU\tMSKU\tDisposition\tCustomer Shipments\tEnding Warehouse Balance',
      '2026-07-21\tFNSKU-1\t\tSELLABLE\t3\t7',
    ].join('\n');

    expect(
      normalizeLedgerRows(tsv, {
        marketplaceId: 'ATVPDKIKX0DER',
        reportId: 'report-1',
        syncRunId: 'run-1',
      }),
    ).toEqual([]);
  });
});
