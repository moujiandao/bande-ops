import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyShipment, marketplaceDay, parseShipmentPromotions, parseShipmentSales,
  reconcileShipmentDays, type ShipmentPromotion,
} from './evidence';

const fixture = (name: string) => readFileSync(new URL(`../amazon/__fixtures__/${name}`, import.meta.url), 'utf8');
const sales = parseShipmentSales(fixture('giveaway-launch-sales.tsv'));
const promotions = parseShipmentPromotions(fixture('giveaway-launch-promotions.tsv'));
const captured = JSON.parse(fixture('giveaway-launch-ledger.json'));
const ledger = captured.rows.map((r: object) => ({ ...r, sku: captured.item.sku }));
const target = sales.filter(s => s.asin === 'B0GNZQ147T');
const sale = target.find(s => promotions.some(p => p.orderId === s.orderId))!;
const promo = promotions.find(p => p.orderId === sale.orderId)!;
const input = { sales, promotions, ledger, startDate: '2026-03-10', endDate: '2026-03-18' };

describe('captured shipment evidence', () => {
  it('reconciles the known launch: 30 ledger units, 28 excluded, 2 remaining', () => {
    expect(target).toHaveLength(30);
    const days = reconcileShipmentDays(input);
    expect(days.every(d => d.status === 'complete')).toBe(true);
    expect(days.reduce((n, d) => n + d.ledger_units, 0)).toBe(30);
    expect(days.reduce((n, d) => n + d.excluded_units!, 0)).toBe(28);
    expect(days.filter(d => d.ledger_units > 0).map(d => d.ledger_units)).toEqual([15, 13, 1, 1]);
    expect(days.filter(d => d.ledger_units > 0).map(d => d.excluded_units)).toEqual([14, 13, 1, 0]);
  });

  it('keeps captured partial discounts and free-shipping offers', () => {
    for (const description of ['US Core Free Shipping Promotion, based off Policies', 'Nagle Item Discount Promotion US Jan 2026']) {
      const p = promotions.find(p => p.description === description)!;
      expect(p).toBeDefined();
      const s = sales.find(s => s.orderId === p.orderId)!;
      expect(classifyShipment(s, [p])).toEqual({ status: 'included', excludedUnits: 0 });
    }
  });

  it('drops destination fields and uses DST-aware Pacific ledger dates', () => {
    expect(Object.keys(sale)).not.toContain('ship-city');
    expect(marketplaceDay('2026-03-16T07:08:03Z')).toBe('2026-03-16');
    expect(marketplaceDay('2026-01-16T07:08:03Z')).toBe('2026-01-15');
  });

  it('refuses an empty report or changed source header', () => {
    expect(() => parseShipmentSales(fixture('giveaway-launch-sales.tsv').split('\n')[0])).toThrow(/no rows/);
    expect(() => parseShipmentPromotions(fixture('giveaway-launch-promotions.tsv').replace('item-promotion-discount', 'renamed-discount'))).toThrow(/Missing shipment field/);
    // Corrupt the captured timestamp to prove an implicit timezone cannot shift
    // exclusions a day while coincidentally preserving daily shipment counts.
    expect(() => parseShipmentSales(fixture('giveaway-launch-sales.tsv').replace('2026-03-18T23:31:06+00:00', '2026-03-18'))).toThrow(/timezone/);
  });
});

// Mutations below are explicit domain cases, not invented Amazon report fixtures.
describe('classification and reconciliation safeguards', () => {
  it('still excludes a full item discount when the description changes', () => {
    expect(classifyShipment(sale, [{ ...promo, description: 'Changed wording' }]))
      .toEqual({ status: 'excluded', excludedUnits: 1, reason: 'full-discount' });
  });
  it('labels mixed promotions as a full-discount giveaway without overstating confirmed Vine', () => {
    expect(classifyShipment(sale, [
      { ...promo, discount: 999 },
      { ...promo, promotionId: 'another-promotion', description: 'Other item promotion', discount: 1000 },
    ])).toEqual({ status: 'excluded', excludedUnits: 1, reason: 'full-discount' });
  });
  it('uses item subtotal for multiple units and keeps fee ambiguity unknown', () => {
    expect(classifyShipment({ ...sale, quantity: 2 }, [{ ...promo, discount: 3998 }])).toMatchObject({ status: 'excluded', excludedUnits: 2 });
    expect(classifyShipment({ ...sale, shippingPrice: 500 }, [{ ...promo, description: 'Unspecified promotion' }])).toMatchObject({ status: 'unknown' });
    expect(classifyShipment({ ...sale, shippingPrice: 1999 }, [{ ...promo, description: 'Free shipping' }])).toMatchObject({ status: 'unknown' });
    expect(classifyShipment({ ...sale, unitPrice: 0 }, [])).toMatchObject({ status: 'unknown' });
  });
  it('does not double count repeated promotions', () => {
    expect(reconcileShipmentDays({ ...input, promotions: [...promotions, ...promotions] }))
      .toEqual(reconcileShipmentDays(input));
  });
  it('invalidates conflicting duplicates and multi-item order matches', () => {
    const conflict: ShipmentPromotion = { ...promo, discount: 0 };
    expect(reconcileShipmentDays({ ...input, promotions: [...promotions, conflict] })
      .find(d => d.activity_date === sale.day)?.excluded_units).toBeNull();
    expect(reconcileShipmentDays({ ...input, sales: [...sales, { ...sale, sku: 'another-item' }] })
      .find(d => d.activity_date === sale.day)?.issue).toBe('ambiguous-shipment-item-match');
  });
  it('refuses mismatched totals and unmatched promotions', () => {
    expect(reconcileShipmentDays({ ...input, sales: sales.filter(s => s !== sale) })
      .find(d => d.activity_date === sale.day)?.excluded_units).toBeNull();
    expect(reconcileShipmentDays({ ...input, promotions: [...promotions, { ...promo, orderId: 'unknown-order', itemId: 'new-item' }] })
      .find(d => d.activity_date === sale.day)?.issue).toBe('unmatched-promotion');
  });
  it('replaces old exclusions with zero when promotions are corrected away', () => {
    const otherPromotions = promotions.filter(p => !target.some(s => s.orderId === p.orderId));
    expect(reconcileShipmentDays({ ...input, promotions: otherPromotions }).every(d => d.excluded_units === 0)).toBe(true);
  });
});
