export const SHIPMENT_CLASSIFICATION_VERSION = 1;
export const MARKETPLACE_TIME_ZONE = 'America/Los_Angeles';
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MARKETPLACE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

export function marketplaceDay(timestamp: string | Date): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid shipment date.');
  return dayFormatter.format(date);
}

export function shiftDay(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}

export interface ShipmentSale {
  orderId: string;
  sku: string;
  fnSku: string;
  asin: string;
  day: string;
  quantity: number;
  currency: string;
  unitPrice: number;
  shippingPrice: number;
  giftWrapPrice: number;
}

export interface ShipmentPromotion {
  orderId: string;
  shipmentId: string;
  itemId: string;
  promotionId: string;
  day: string;
  currency: string;
  discount: number;
  description: string;
}

/** Parse source TSV including BOM, quoted tabs/newlines, and escaped quotes. */
function tsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (cell === '' && !closed) quoted = true;
      else throw new Error('Malformed shipment report quoting.');
    } else if (!quoted && (c === '\t' || c === '\n' || c === '\r')) {
      row.push(cell); cell = ''; closed = false;
      if (c !== '\t') {
        if (c === '\r' && input[i + 1] === '\n') i++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else {
      if (closed) throw new Error('Unexpected text after a quoted report cell.');
      cell += c;
    }
  }
  if (quoted) throw new Error('Unterminated shipment report cell.');
  if (cell || row.length) rows.push([...row, cell]);
  const headers = rows.shift();
  if (!headers?.length || new Set(headers).size !== headers.length) throw new Error('Missing or duplicate report headers.');
  return rows.map((values) => {
    if (values.length !== headers.length) throw new Error('Shipment report column count changed.');
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]));
  });
}

function required(row: Record<string, string>, key: string): string {
  if (!row[key]?.trim()) throw new Error(`Missing shipment field: ${key}.`);
  return row[key].trim();
}

/** Integer cents avoid floating-point equality for a fully discounted subtotal. */
function money(row: Record<string, string>, key: string): number {
  const raw = required(row, key);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`Invalid amount in ${key}.`);
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount out of range in ${key}.`);
  return cents;
}

function sourceDay(row: Record<string, string>): string {
  const value = required(row, 'shipment-date');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('Shipment timestamp must include an explicit timezone.');
  }
  return marketplaceDay(value);
}

export function parseShipmentSales(text: string): ShipmentSale[] {
  const rows = tsv(text);
  // A download containing only headers cannot establish complete coverage.
  if (!rows.length) throw new Error('Shipment sales report has no rows; coverage is unverified.');
  return rows.map((r) => {
    const quantity = Number(required(r, 'quantity'));
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Invalid shipment quantity.');
    return {
      orderId: required(r, 'amazon-order-id'), sku: required(r, 'sku'),
      fnSku: required(r, 'fnsku'), asin: required(r, 'asin'),
      day: sourceDay(r), quantity,
      currency: required(r, 'currency'), unitPrice: money(r, 'item-price-per-unit'),
      shippingPrice: money(r, 'shipping-price'), giftWrapPrice: money(r, 'gift-wrap-price'),
    };
  });
}

export function parseShipmentPromotions(text: string): ShipmentPromotion[] {
  const rows = tsv(text);
  if (!rows.length) throw new Error('Shipment promotion report has no rows; coverage is unverified.');
  return rows.map((r) => ({
    orderId: required(r, 'amazon-order-id'), shipmentId: required(r, 'shipment-id'),
    itemId: required(r, 'shipment-item-id'), promotionId: required(r, 'item-promotion-id'),
    day: sourceDay(r), currency: required(r, 'currency'),
    discount: money(r, 'item-promotion-discount'), description: required(r, 'description'),
  }));
}

export type ShipmentDecision =
  | { status: 'included'; excludedUnits: 0 }
  | { status: 'excluded'; excludedUnits: number; reason: 'vine' | 'full-discount' }
  | { status: 'unknown'; reason: string };

const VINE_DESCRIPTION = 'Auto-generated promotion for Amazon Vine enrollment';

/** A single unambiguous shipment item, using prices before promotions. */
export function classifyShipment(sale: ShipmentSale, promotions: ShipmentPromotion[]): ShipmentDecision {
  const subtotal = sale.unitPrice * sale.quantity;
  const fees = sale.shippingPrice + sale.giftWrapPrice;
  if (sale.currency !== 'USD') return { status: 'unknown', reason: 'unsupported-currency' };
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0) return { status: 'unknown', reason: 'unknown-item-subtotal' };
  if (promotions.some(p => p.currency !== sale.currency || p.day !== sale.day)) return { status: 'unknown', reason: 'promotion-date-or-currency-mismatch' };
  const discount = promotions.reduce((sum, p) => sum + p.discount, 0);
  const vineDiscount = promotions.filter(p => p.description === VINE_DESCRIPTION)
    .reduce((sum, p) => sum + p.discount, 0);
  if (!Number.isSafeInteger(discount) || discount > subtotal + fees) return { status: 'unknown', reason: 'discount-exceeds-charges' };
  // When discounts cover every charge, the item is necessarily fully discounted.
  // With no shipping/gift charges this is exactly discount == item subtotal.
  if (discount === subtotal + fees) {
    return { status: 'excluded', excludedUnits: sale.quantity,
      reason: vineDiscount === subtotal ? 'vine' : 'full-discount' };
  }
  if (vineDiscount === subtotal) return { status: 'excluded', excludedUnits: sale.quantity, reason: 'vine' };
  if (promotions.some(p => p.description === VINE_DESCRIPTION)) return { status: 'unknown', reason: 'vine-discount-does-not-reconcile' };
  if (sale.quantity > 1 && discount >= sale.unitPrice) return { status: 'unknown', reason: 'mixed-unit-discounts-ambiguous' };
  if (discount < subtotal) return { status: 'included', excludedUnits: 0 };
  // These reports do not separate item discounts from shipping discounts. If
  // fees could explain part of a subtotal-sized discount, do not guess.
  return { status: 'unknown', reason: 'item-versus-shipping-discount-ambiguous' };
}

export interface LedgerShipmentDay {
  sku: string;
  activity_date: string;
  customer_shipments: number;
  customer_shipments_valid: boolean | null;
}

export interface DailyShipmentAdjustment {
  sku: string;
  activity_date: string;
  ledger_units: number;
  shipment_units: number;
  excluded_units: number | null;
  vine_units: number;
  status: 'complete' | 'unknown';
  issue: string | null;
}

/** No order IDs or destination fields leave this boundary. */
export function reconcileShipmentDays(input: {
  sales: ShipmentSale[];
  promotions: ShipmentPromotion[];
  ledger: LedgerShipmentDay[];
  startDate: string;
  endDate: string;
}): DailyShipmentAdjustment[] {
  const byOrder = new Map<string, ShipmentSale[]>();
  for (const sale of input.sales) {
    const rows = byOrder.get(sale.orderId) ?? []; rows.push(sale); byOrder.set(sale.orderId, rows);
  }
  const byPromotionOrder = new Map<string, ShipmentPromotion[]>();
  const seen = new Map<string, ShipmentPromotion>();
  const conflictingOrders = new Set<string>();
  for (const p of input.promotions) {
    const key = JSON.stringify([p.shipmentId, p.itemId, p.promotionId]);
    const previous = seen.get(key);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(p)) { conflictingOrders.add(p.orderId); conflictingOrders.add(previous.orderId); }
      continue;
    }
    seen.set(key, p);
    const rows = byPromotionOrder.get(p.orderId) ?? []; rows.push(p); byPromotionOrder.set(p.orderId, rows);
  }
  // An unmatched promotion within published dates may belong to a missing sales
  // row. Without its SKU, no SKU-day in that range can be asserted complete.
  const unmatchedDays = new Set(input.promotions.filter(p => !byOrder.has(p.orderId)).map(p => p.day));
  const byDay = new Map<string, { units: number; excluded: number; vine: number; issue: string | null }>();
  for (const sale of input.sales) {
    if (sale.day < input.startDate || sale.day > input.endDate) continue;
    const key = JSON.stringify([sale.sku, sale.day]);
    const day = byDay.get(key) ?? { units: 0, excluded: 0, vine: 0, issue: null };
    day.units += sale.quantity;
    const promotions = byPromotionOrder.get(sale.orderId) ?? [];
    const ambiguous = promotions.length > 0 && (
      byOrder.get(sale.orderId)!.length !== 1 ||
      new Set(promotions.map(p => JSON.stringify([p.shipmentId, p.itemId]))).size !== 1
    );
    const decision = conflictingOrders.has(sale.orderId)
      ? { status: 'unknown' as const, reason: 'conflicting-promotion-rows' }
      : ambiguous ? { status: 'unknown' as const, reason: 'ambiguous-shipment-item-match' }
        : classifyShipment(sale, promotions);
    if (decision.status === 'unknown') day.issue = decision.reason;
    else {
      day.excluded += decision.excludedUnits;
      if (decision.status === 'excluded' && decision.reason === 'vine') day.vine += decision.excludedUnits;
    }
    byDay.set(key, day);
  }
  return input.ledger.filter(l => l.activity_date >= input.startDate && l.activity_date <= input.endDate).map(l => {
    const s = byDay.get(JSON.stringify([l.sku, l.activity_date])) ?? { units: 0, excluded: 0, vine: 0, issue: null };
    const ledgerKnown = Number.isSafeInteger(l.customer_shipments) && l.customer_shipments >= 0 &&
      (l.customer_shipments_valid === true || (l.customer_shipments_valid === null && l.customer_shipments > 0));
    const issue = !ledgerKnown ? 'invalid-ledger-count'
      : unmatchedDays.has(l.activity_date) ? 'unmatched-promotion'
        : s.units !== l.customer_shipments ? 'shipment-ledger-mismatch' : s.issue;
    return { sku: l.sku, activity_date: l.activity_date, ledger_units: l.customer_shipments,
      shipment_units: s.units, excluded_units: issue ? null : s.excluded,
      vine_units: s.vine, status: issue ? 'unknown' : 'complete', issue };
  });
}
