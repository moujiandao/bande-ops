import { describe, it, expect } from 'vitest';
import { acos, roas } from './metrics';

// ACOS = cost / sales; ROAS = sales / cost. Both are COMPUTED by us (Amazon
// never returns them). The load-bearing rule here is the divide-by-zero /
// UNKNOWN-input invariant:
//   - a null input -> null (UNKNOWN)
//   - a ZERO denominator (sales for ACOS, cost for ROAS) -> null (UNKNOWN),
//     NEVER 0 and NEVER Infinity coerced to a number
//   - only two finite numbers with a non-zero denominator -> the ratio
//
// These tests assert exhaustively that the "no answer" cases yield null, and
// crucially that they are NEVER a numeric 0 or a non-finite number.

describe('acos (cost / sales)', () => {
  it('computes the ratio for two valid finite numbers', () => {
    // 40 spend / 200 sales = 0.2 (20% ACOS).
    expect(acos(40, 200)).toBe(0.2);
    expect(acos(50, 100)).toBe(0.5);
    expect(acos(0, 100)).toBe(0); // true zero spend -> a real 0 ACOS, not UNKNOWN
  });

  it('returns null (UNKNOWN) when sales is 0 — never 0, never Infinity', () => {
    const result = acos(15, 0);
    expect(result).toBeNull();
    expect(result).not.toBe(0);
    expect(result).not.toBe(Infinity);
    expect(Number.isFinite(result as number)).toBe(false);
  });

  it('returns null when sales is null (UNKNOWN), never 0', () => {
    const result = acos(15, null);
    expect(result).toBeNull();
    expect(result).not.toBe(0);
  });

  it('returns null when cost is null', () => {
    expect(acos(null, 200)).toBeNull();
  });

  it('returns null when both inputs are null', () => {
    expect(acos(null, null)).toBeNull();
  });

  it.each([
    { cost: 15, sales: 0, label: 'spend, no sales' },
    { cost: 15, sales: null, label: 'spend, UNKNOWN sales' },
    { cost: null, sales: 0, label: 'UNKNOWN spend, no sales' },
    { cost: null, sales: null, label: 'all UNKNOWN' },
    { cost: 0, sales: 0, label: 'zeros both' },
  ])('never yields a numeric 0 for the UNKNOWN case: $label', ({ cost, sales }) => {
    const result = acos(cost, sales);
    expect(result).toBeNull();
    // The whole point: an UNKNOWN ACOS must be null, not a misleading 0.
    expect(result === 0).toBe(false);
  });

  it('returns null for a non-finite cost input (NaN/Infinity)', () => {
    expect(acos(Number.NaN, 200)).toBeNull();
    expect(acos(Number.POSITIVE_INFINITY, 200)).toBeNull();
  });
});

describe('roas (sales / cost)', () => {
  it('computes the ratio for two valid finite numbers', () => {
    // 200 sales / 40 spend = 5x ROAS.
    expect(roas(200, 40)).toBe(5);
    expect(roas(100, 50)).toBe(2);
    expect(roas(0, 50)).toBe(0); // true zero sales -> a real 0 ROAS, not UNKNOWN
  });

  it('returns null (UNKNOWN) when cost is 0 — never 0, never Infinity', () => {
    const result = roas(200, 0);
    expect(result).toBeNull();
    expect(result).not.toBe(0);
    expect(result).not.toBe(Infinity);
  });

  it('returns null when cost is null (UNKNOWN), never 0', () => {
    const result = roas(200, null);
    expect(result).toBeNull();
    expect(result).not.toBe(0);
  });

  it('returns null when sales is null', () => {
    expect(roas(null, 40)).toBeNull();
  });

  it('returns null when both inputs are null', () => {
    expect(roas(null, null)).toBeNull();
  });

  it.each([
    { sales: 200, cost: 0, label: 'sales, zero spend' },
    { sales: 200, cost: null, label: 'sales, UNKNOWN spend' },
    { sales: null, cost: 0, label: 'UNKNOWN sales, zero spend' },
    { sales: null, cost: null, label: 'all UNKNOWN' },
  ])('never yields a numeric 0 for the UNKNOWN case: $label', ({ sales, cost }) => {
    const result = roas(sales, cost);
    expect(result).toBeNull();
    expect(result === 0).toBe(false);
  });

  it('returns null for a non-finite cost input (NaN/Infinity)', () => {
    expect(roas(200, Number.NaN)).toBeNull();
    expect(roas(200, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
