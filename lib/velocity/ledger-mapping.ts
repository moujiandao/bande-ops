export interface NormalizeLedgerOptions {
  marketplaceId: string;
  reportId: string;
  syncRunId: string;
}

export interface FbaDailyVelocityInputRow {
  marketplace_id: string;
  sku: string;
  fn_sku: string | null;
  activity_date: string;
  customer_shipments: number;
  sellable_ending_balance: number | null;
  is_in_stock: boolean;
  report_id: string;
  sync_run_id: string;
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeLedgerRows(
  tsv: string,
  opts: NormalizeLedgerOptions,
): FbaDailyVelocityInputRow[] {
  const [headerLine, ...lines] = tsv.trim().split(/\r?\n/);
  if (!headerLine) return [];

  const headers = headerLine.split('\t');
  const column = (name: string): number => headers.indexOf(name);
  const rows: FbaDailyVelocityInputRow[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split('\t');
    if (cells[column('Disposition')] !== 'SELLABLE') continue;
    const sku = cells[column('MSKU')]?.trim() ?? '';
    if (!sku) continue;

    const endingBalance = parseNumber(cells[column('Ending Warehouse Balance')]);
    rows.push({
      marketplace_id: opts.marketplaceId,
      sku,
      fn_sku: cells[column('FNSKU')] || null,
      activity_date: cells[column('Date')] ?? '',
      customer_shipments: parseNumber(cells[column('Customer Shipments')]) ?? 0,
      sellable_ending_balance: endingBalance,
      is_in_stock: endingBalance !== null && endingBalance > 0,
      report_id: opts.reportId,
      sync_run_id: opts.syncRunId,
    });
  }

  return rows;
}
