import { describe, expect, it } from 'vitest';
import { parseSvdInventoryHtml } from './parse';

describe('parseSvdInventoryHtml', () => {
  it('parses numeric and out-of-stock availability', () => {
    const html = `
      <table>
        <tr><th>Item ID:</th><th>Description:</th><th>Availability:</th></tr>
        <tr><td>babytracker_notebook_boy</td><td>Baby Boy 1 notebook</td><td>7</td></tr>
        <tr><td>babytracker_notebook_girl</td><td>Baby Girl</td><td>Temporarily Out of Stock</td></tr>
      </table>
    `;

    expect(parseSvdInventoryHtml(html)).toEqual([
      {
        svdItemId: 'babytracker_notebook_boy',
        description: 'Baby Boy 1 notebook',
        quantity: 7,
        rawAvailability: '7',
      },
      {
        svdItemId: 'babytracker_notebook_girl',
        description: 'Baby Girl',
        quantity: 0,
        rawAvailability: 'Temporarily Out of Stock',
      },
    ]);
  });

  it('returns null quantity for unrecognized availability', () => {
    const html =
      '<table><tr><td>x</td><td>X</td><td>Call for availability</td></tr></table>';

    expect(parseSvdInventoryHtml(html)[0].quantity).toBeNull();
  });
});
