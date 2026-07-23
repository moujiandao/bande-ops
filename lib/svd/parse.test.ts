import { describe, expect, it } from 'vitest';
import { parseSvdInventoryHtml } from './parse';

/**
 * Markup captured from a real SVD offer-list page (OeFrame.asp?Action=NEWORDER),
 * reduced to the parts that matter. Two things it preserves deliberately:
 *
 * 1. The cells are identified by `clsIDData` / `clsDESCData` / `clsAvailData`
 *    with an `id` suffix pairing them, NOT by position — a row also carries an
 *    image cell, an order-qty cell and an add-to-cart cell.
 * 2. Rows are nested inside other tables and interleaved with inline <script>,
 *    so naive `<tr>` splitting mangles the first row and swallows JS as cells.
 */
const realHtml = `
<table>
  <tr class='clsOfferHdrRow'>
    <td>Item ID:</td><td>Image</td><td>Description:</td>
    <td>Availability:</td><td>Quantity</td><td>Add to Cart</td>
  </tr>
  <script>function ValidateAmount(a,b){ if (a > 0) { return "<tr><td>x</td></tr>"; } }</script>
  <tr class='clsOfferOddRow'>
    <td id='TNData1' class='clsOffData clsTNData'><img src="/img/1.jpg"></td>
    <td id='IDData1' class='clsOffData clsIDData'>babytracker_notebook_boy</td>
    <td id='DESCData1' class='clsOffData clsDESCData'>1 notebook + assorted cards babyboy</td>
    <td id='AvailData1' class='clsOffData clsAvailData'>7</td>
    <td id='OrdQtyData1' class='clsOffData clsOrdQtyData'><input name="Qty1"></td>
    <td id='AddAllCartData1' class='clsOffData clsAddAllCartData'><input type="checkbox"></td>
  </tr>
  <tr class='clsOfferEvenRow'>
    <td id='TNData2' class='clsOffData clsTNData'></td>
    <td id='IDData2' class='clsOffData clsIDData'>babytracker_notebook_girl</td>
    <td id='DESCData2' class='clsOffData clsDESCData'>1 notebook + assorted cards babygirl</td>
    <td id='AvailData2' class='clsOffData clsAvailData'>Temporarily Out of Stock</td>
    <td id='OrdQtyData2' class='clsOffData clsOrdQtyData'><input name="Qty2"></td>
  </tr>
  <tr class='clsOfferOddRow'>
    <td id='IDData3' class='clsOffData clsIDData'>brainsheet_erhorizontal_single</td>
    <td id='DESCData3' class='clsOffData clsDESCData'>template 23</td>
    <td id='AvailData3' class='clsOffData clsAvailData'>13</td>
  </tr>
</table>
`;

describe('parseSvdInventoryHtml', () => {
  it('parses every offer row from real offer-list markup', () => {
    expect(parseSvdInventoryHtml(realHtml)).toEqual([
      {
        svdItemId: 'babytracker_notebook_boy',
        description: '1 notebook + assorted cards babyboy',
        quantity: 7,
        rawAvailability: '7',
      },
      {
        svdItemId: 'babytracker_notebook_girl',
        description: '1 notebook + assorted cards babygirl',
        quantity: 0,
        rawAvailability: 'Temporarily Out of Stock',
      },
      {
        svdItemId: 'brainsheet_erhorizontal_single',
        description: 'template 23',
        quantity: 13,
        rawAvailability: '13',
      },
    ]);
  });

  it('does not mistake the header row for an offer', () => {
    const items = parseSvdInventoryHtml(realHtml);
    expect(items.some((i) => /item id/i.test(i.svdItemId))).toBe(false);
    expect(items).toHaveLength(3);
  });

  it('does not treat inline script as an offer row', () => {
    const items = parseSvdInventoryHtml(realHtml);
    expect(items.some((i) => /function|ValidateAmount/.test(i.description))).toBe(
      false,
    );
  });

  it('returns null quantity for unrecognized availability, never 0', () => {
    const html = `
      <td id='IDData1' class='clsOffData clsIDData'>x</td>
      <td id='DESCData1' class='clsOffData clsDESCData'>X</td>
      <td id='AvailData1' class='clsOffData clsAvailData'>Call for availability</td>
    `;

    const [item] = parseSvdInventoryHtml(html);
    // UNKNOWN must never fold to 0 — it drives "Needs review" downstream.
    expect(item.quantity).toBeNull();
    expect(item.rawAvailability).toBe('Call for availability');
  });

  it('pairs cells by their id suffix rather than document order', () => {
    // The availability cell for item 2 appears before item 1's in source order.
    const html = `
      <td id='IDData1' class='clsOffData clsIDData'>alpha</td>
      <td id='DESCData1' class='clsOffData clsDESCData'>Alpha</td>
      <td id='IDData2' class='clsOffData clsIDData'>beta</td>
      <td id='DESCData2' class='clsOffData clsDESCData'>Beta</td>
      <td id='AvailData2' class='clsOffData clsAvailData'>5</td>
      <td id='AvailData1' class='clsOffData clsAvailData'>9</td>
    `;

    expect(parseSvdInventoryHtml(html)).toEqual([
      { svdItemId: 'alpha', description: 'Alpha', quantity: 9, rawAvailability: '9' },
      { svdItemId: 'beta', description: 'Beta', quantity: 5, rawAvailability: '5' },
    ]);
  });

  it('returns nothing rather than garbage when the page shape changes', () => {
    // A logged-out or redesigned page must yield no rows, so the sync records a
    // failure instead of silently writing an empty-but-valid inventory.
    expect(parseSvdInventoryHtml('<html><body>Please log in</body></html>')).toEqual(
      [],
    );
  });
});
