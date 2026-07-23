export interface MerchantListing {
  sku: string;
  title: string;
  asin: string;
  /** Listing creation date as ISO YYYY-MM-DD, or null when Amazon omits it. */
  openDate: string | null;
  status: string;
  fulfillmentChannel: string;
}

/**
 * Amazon prefixes this report with a UTF-8 BOM, which otherwise becomes part of
 * the first header name and breaks the column lookup.
 */
function stripBom(text: string): string {
  return text.replace(/^﻿/, '');
}

/**
 * open-date looks like "2022-05-31 17:21:53 PDT". The timezone abbreviation is
 * not reliably parseable by Date across runtimes, and only the calendar date
 * matters for listing age, so take the leading YYYY-MM-DD verbatim.
 */
function toOpenDate(raw: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  return match ? match[1] : null;
}

/**
 * Parse GET_MERCHANT_LISTINGS_ALL_DATA. This is the only source of a listing's
 * open-date, which separates a genuinely dead SKU from a new one that has not
 * sold yet. Unlike the ledger report, cells here are NOT quoted.
 */
export function parseMerchantListings(tsv: string): MerchantListing[] {
  const [headerLine, ...lines] = stripBom(tsv).trim().split(/\r?\n/);
  if (!headerLine) return [];

  const headers = headerLine.split('\t').map((h) => h.trim());
  const cellAt = (cells: string[], name: string): string => {
    const index = headers.indexOf(name);
    return index === -1 ? '' : (cells[index] ?? '').trim();
  };

  const listings: MerchantListing[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const sku = cellAt(cells, 'seller-sku');
    if (!sku) continue;

    listings.push({
      sku,
      title: cellAt(cells, 'item-name'),
      asin: cellAt(cells, 'asin1'),
      openDate: toOpenDate(cellAt(cells, 'open-date')),
      status: cellAt(cells, 'status'),
      fulfillmentChannel: cellAt(cells, 'fulfillment-channel'),
    });
  }

  return listings;
}
