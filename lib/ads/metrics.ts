/**
 * Pure, I/O-free computation of the two derived advertising efficiency metrics:
 * ACOS (Advertising Cost of Sales) and ROAS (Return on Ad Spend).
 *
 * Amazon does NOT return these — it returns raw `cost` (ad spend) and
 * attribution-windowed `sales`. We compute the ratios here so the
 * divide-by-zero / UNKNOWN rule lives in exactly one tested place.
 *
 * THE INVARIANT (mirrors UNKNOWN-budget / UNKNOWN-stock):
 *   - Any null input -> null (UNKNOWN). We have no number; we report none.
 *   - A ZERO denominator -> null (UNKNOWN), NEVER 0 and NEVER a coerced
 *     Infinity. "No sales" means ACOS is undefined, not 0% and not infinite.
 *   - A non-finite input (NaN/Infinity) -> null (defensive; upstream parsers
 *     should already have nulled these, but never let one leak into a ratio).
 *   - Otherwise -> the finite ratio (a true numerator of 0 yields a real 0,
 *     which is meaningfully distinct from UNKNOWN: e.g. 0 spend -> 0% ACOS).
 */

/** A finite number guard: rejects null, NaN, and ±Infinity. */
function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * ACOS = cost / sales. The fraction of attributed sales spent on ads.
 * Returns null (UNKNOWN) when cost is missing, or when sales is 0/null —
 * dividing by no sales has no defined answer, so we never coerce it to 0 or ∞.
 */
export function acos(cost: number | null, sales: number | null): number | null {
  if (!isFiniteNumber(cost) || !isFiniteNumber(sales)) return null;
  // Zero sales -> UNKNOWN (null), NEVER 0, NEVER Infinity.
  if (sales === 0) return null;
  return cost / sales;
}

/**
 * ROAS = sales / cost. Dollars of attributed sales per dollar of ad spend.
 * Returns null (UNKNOWN) when sales is missing, or when cost is 0/null —
 * dividing by no spend has no defined answer, so we never coerce it to 0 or ∞.
 */
export function roas(sales: number | null, cost: number | null): number | null {
  if (!isFiniteNumber(sales) || !isFiniteNumber(cost)) return null;
  // Zero cost -> UNKNOWN (null), NEVER 0, NEVER Infinity.
  if (cost === 0) return null;
  return sales / cost;
}
