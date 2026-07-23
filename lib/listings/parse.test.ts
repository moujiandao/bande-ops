import { describe, expect, it } from 'vitest';
import { parseMerchantListings } from './parse';

/**
 * Header captured verbatim from a real GET_MERCHANT_LISTINGS_ALL_DATA
 * document, including the leading BOM. Two traps it preserves:
 *
 * 1. A BOM precedes "item-name", so a naive indexOf('item-name') misses and
 *    every row loses its title — the same class of failure that silently
 *    emptied the ledger parse.
 * 2. open-date carries a timezone ABBREVIATION ("2022-05-31 17:21:53 PDT").
 *    new Date() parses those inconsistently across runtimes, so only the
 *    calendar date is taken.
 */
const HEADER =
  '﻿item-name\titem-description\tlisting-id\tseller-sku\tprice\tquantity\topen-date\timage-url\titem-is-marketplace\tproduct-id-type\tzshop-shipping-fee\titem-note\titem-condition\tzshop-category1\tzshop-browse-path\tzshop-storefront-feature\tasin1\tasin2\tasin3\twill-ship-internationally\texpedited-shipping\tzshop-boldface\tproduct-id\tbid-for-featured-placement\tadd-delete\tpending-quantity\tfulfillment-channel\toptional-payment-type-exclusion\tmerchant-shipping-group\tstatus';

function row(opts: {
  name?: string;
  sku: string;
  openDate?: string;
  asin?: string;
  status?: string;
  channel?: string;
}): string {
  const cells = new Array(30).fill('');
  cells[0] = opts.name ?? 'A Product';
  cells[2] = 'LISTING-1';
  cells[3] = opts.sku;
  cells[6] = opts.openDate ?? '2022-05-31 17:21:53 PDT';
  cells[16] = opts.asin ?? 'B07JYBYMGN';
  cells[26] = opts.channel ?? 'AMAZON_NA';
  cells[29] = opts.status ?? 'Active';
  return cells.join('\t');
}

describe('parseMerchantListings', () => {
  it('parses a real listings row despite the BOM on the header', () => {
    const tsv = [
      HEADER,
      row({ sku: 'babytracker_notebook_boy_g2', name: 'Medical Basics Baby Journal' }),
    ].join('\n');

    expect(parseMerchantListings(tsv)).toEqual([
      {
        sku: 'babytracker_notebook_boy_g2',
        title: 'Medical Basics Baby Journal',
        asin: 'B07JYBYMGN',
        openDate: '2022-05-31',
        status: 'Active',
        fulfillmentChannel: 'AMAZON_NA',
      },
    ]);
  });

  it('takes only the calendar date from a timezone-suffixed open-date', () => {
    const tsv = [
      HEADER,
      row({ sku: 'a', openDate: '2019-12-02 19:40:38 PST' }),
    ].join('\n');

    expect(parseMerchantListings(tsv)[0].openDate).toBe('2019-12-02');
  });

  it('leaves openDate null when absent rather than guessing a date', () => {
    const tsv = [HEADER, row({ sku: 'a', openDate: '' })].join('\n');

    expect(parseMerchantListings(tsv)[0].openDate).toBeNull();
  });

  it('skips rows with no seller-sku', () => {
    const tsv = [HEADER, row({ sku: '' }), row({ sku: 'real' })].join('\n');

    expect(parseMerchantListings(tsv).map((l) => l.sku)).toEqual(['real']);
  });

  it('returns nothing for an empty document', () => {
    expect(parseMerchantListings('')).toEqual([]);
  });
});
