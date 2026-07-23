import { describe, expect, it } from 'vitest';
import { normalizeLedgerRows } from './ledger-mapping';

/**
 * Header captured verbatim from a real GET_LEDGER_SUMMARY_VIEW_DATA document.
 * Three things it preserves that the previous hand-written fixture did not,
 * each of which broke the parser against production:
 *
 * 1. Every value is wrapped in double quotes, so `headers.indexOf('Date')`
 *    never matched and all 18k rows were silently skipped.
 * 2. Dates are MM/DD/YYYY, not ISO — they sort wrong and are not a valid
 *    Postgres date literal.
 * 3. "Customer Shipments" is NEGATIVE (units leaving the warehouse).
 */
const HEADER =
  '"Date"\t"FNSKU"\t"ASIN"\t"MSKU"\t"Title"\t"Disposition"\t"Starting Warehouse Balance"\t"In Transit Between Warehouses"\t"Receipts"\t"Customer Shipments"\t"Customer Returns"\t"Vendor Returns"\t"Warehouse Transfer In/Out"\t"Found"\t"Lost"\t"Damaged"\t"Disposed"\t"Other Events"\t"Ending Warehouse Balance"\t"Unknown Events"\t"Location"\t"Store"';

function row(
  date: string,
  fnsku: string,
  msku: string,
  disposition: string,
  shipments: string,
  endingBalance: string,
): string {
  return (
    [
      date, fnsku, 'B01HU6984K', msku, 'H&P Notebook (2 Pack)', disposition,
      '159', '0', '0', shipments, '0', '0', '0', '0', '0', '0', '0', '0',
      endingBalance, '0', 'US',
    ]
      .map((cell) => `"${cell}"`)
      .join('\t') + '\t'
  );
}

const OPTS = {
  marketplaceId: 'ATVPDKIKX0DER',
  reportId: 'report-1',
  syncRunId: 'run-1',
};

describe('normalizeLedgerRows', () => {
  it('parses quoted cells from a real ledger document', () => {
    const tsv = [
      HEADER,
      row('07/21/2026', 'X001518VF5', 'hp_notebook_2pack', 'SELLABLE', '-1', '158'),
    ].join('\n');

    const rows = normalizeLedgerRows(tsv, OPTS);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      marketplace_id: 'ATVPDKIKX0DER',
      sku: 'hp_notebook_2pack',
      fn_sku: 'X001518VF5',
      sellable_ending_balance: 158,
      is_in_stock: true,
      report_id: 'report-1',
      sync_run_id: 'run-1',
    });
  });

  it('converts MM/DD/YYYY dates to ISO so they sort and store correctly', () => {
    const tsv = [
      HEADER,
      row('07/21/2026', 'X1', 'sku-a', 'SELLABLE', '-1', '10'),
      row('12/01/2025', 'X1', 'sku-a', 'SELLABLE', '-2', '20'),
    ].join('\n');

    const rows = normalizeLedgerRows(tsv, OPTS);

    expect(rows.map((r) => r.activity_date)).toEqual(['2026-07-21', '2025-12-01']);
  });

  it('records customer shipments as positive units of demand', () => {
    // The ledger reports shipments as negative (stock leaving). Velocity is
    // units sold per day, so -3 must become 3.
    const tsv = [
      HEADER,
      row('07/21/2026', 'X1', 'sku-a', 'SELLABLE', '-3', '10'),
    ].join('\n');

    expect(normalizeLedgerRows(tsv, OPTS)[0].customer_shipments).toBe(3);
  });

  it('keeps only SELLABLE dispositions', () => {
    const tsv = [
      HEADER,
      row('07/21/2026', 'X1', 'sku-a', 'SELLABLE', '-1', '10'),
      row('07/21/2026', 'X1', 'sku-a', 'WAREHOUSE_DAMAGED', '0', '14'),
      row('07/21/2026', 'X1', 'sku-a', 'CUSTOMER_DAMAGED', '0', '2'),
    ].join('\n');

    const rows = normalizeLedgerRows(tsv, OPTS);
    expect(rows).toHaveLength(1);
    expect(rows[0].sellable_ending_balance).toBe(10);
  });

  it('treats a zero ending balance as out of stock, not unknown', () => {
    const tsv = [
      HEADER,
      row('07/21/2026', 'X1', 'sku-a', 'SELLABLE', '0', '0'),
    ].join('\n');

    const [parsed] = normalizeLedgerRows(tsv, OPTS);
    expect(parsed.sellable_ending_balance).toBe(0);
    expect(parsed.is_in_stock).toBe(false);
  });

  it('leaves an unparseable ending balance as UNKNOWN rather than 0', () => {
    const tsv = [
      HEADER,
      row('07/21/2026', 'X1', 'sku-a', 'SELLABLE', '-1', 'n/a'),
    ].join('\n');

    const [parsed] = normalizeLedgerRows(tsv, OPTS);
    expect(parsed.sellable_ending_balance).toBeNull();
    expect(parsed.is_in_stock).toBe(false);
  });

  it('collapses multiple SELLABLE rows for one SKU and day into a single row', () => {
    // One MSKU can appear several times per day (multiple FNSKUs / locations).
    // The mirror is keyed (marketplace_id, sku, activity_date), so duplicates
    // must be aggregated here or the upsert fails outright.
    const tsv = [
      HEADER,
      row('07/21/2026', 'X1', 'sku-a', 'SELLABLE', '-2', '10'),
      row('07/21/2026', 'X2', 'sku-a', 'SELLABLE', '-3', '5'),
    ].join('\n');

    const rows = normalizeLedgerRows(tsv, OPTS);

    expect(rows).toHaveLength(1);
    // Demand sums; stock on hand sums across the SKU's FNSKUs.
    expect(rows[0].customer_shipments).toBe(5);
    expect(rows[0].sellable_ending_balance).toBe(15);
    expect(rows[0].is_in_stock).toBe(true);
  });

  it('keeps different days and different SKUs separate when aggregating', () => {
    const tsv = [
      HEADER,
      row('07/21/2026', 'X1', 'sku-a', 'SELLABLE', '-1', '10'),
      row('07/20/2026', 'X1', 'sku-a', 'SELLABLE', '-1', '11'),
      row('07/21/2026', 'X1', 'sku-b', 'SELLABLE', '-1', '12'),
    ].join('\n');

    expect(normalizeLedgerRows(tsv, OPTS)).toHaveLength(3);
  });

  it('returns nothing for an empty document', () => {
    expect(normalizeLedgerRows('', OPTS)).toEqual([]);
  });
});
