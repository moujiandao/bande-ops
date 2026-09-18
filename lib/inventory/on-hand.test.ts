import { describe, expect, it } from 'vitest';
import { fbaOnHand, reservedExcludingFcTransfers } from './on-hand';

describe('FBA on-hand quantities', () => {
  it('counts available and transferring units, including true zero', () => {
    expect(fbaOnHand(422, 3008)).toBe(3430);
    expect(fbaOnHand(0, 3008)).toBe(3008);
    expect(fbaOnHand(0, 0)).toBe(0);
  });

  it.each([null, undefined, NaN, Infinity, -1])('preserves unknown or invalid buckets (%s)', (unknown) => {
    expect(fbaOnHand(422, unknown)).toBeNull();
    expect(fbaOnHand(unknown, 3008)).toBeNull();
  });

  it('removes transfers from the API reserved total without counting them twice', () => {
    expect(reservedExcludingFcTransfers(3187, 3004)).toBe(183);
    expect(reservedExcludingFcTransfers(0, 0)).toBe(0);
    expect(reservedExcludingFcTransfers(100, null)).toBeNull();
    expect(reservedExcludingFcTransfers(null, 10)).toBeNull();
    expect(reservedExcludingFcTransfers(5, 10)).toBeNull();
  });
});
