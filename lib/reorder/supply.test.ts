import { describe, expect, it } from 'vitest';
import { calculateUsableSupply, toUnits } from './supply';

const policy = {
  countAwdAvailable: true,
  countAwdReplenishment: false,
  countInboundWorking: false,
  countInboundShipped: true,
  countInboundReceiving: true,
};

describe('calculateUsableSupply', () => {
  it('counts approved supply buckets', () => {
    expect(
      calculateUsableSupply({
        fba: {
          fulfillableQuantity: 10,
          inboundWorkingQuantity: 99,
          inboundShippedQuantity: 3,
          inboundReceivingQuantity: 2,
        },
        awd: { availableQuantity: 8, replenishmentQuantity: 0 },
        svd: { quantity: 7 },
        svdUnitsPerBox: 60,
        policy,
      }),
    ).toMatchObject({
      status: 'ok',
      // 10 fulfillable + 3 shipped + 2 receiving + 8 AWD + (7 boxes × 60) SVD.
      // inboundWorking is excluded by policy.
      usableSupply: 443,
    });
  });

  it('returns needs-review when a required source is unknown', () => {
    expect(
      calculateUsableSupply({
        fba: {
          fulfillableQuantity: null,
          inboundWorkingQuantity: 0,
          inboundShippedQuantity: 0,
          inboundReceivingQuantity: 0,
        },
        awd: { availableQuantity: 0, replenishmentQuantity: 0 },
        svd: { quantity: 0 },
        svdUnitsPerBox: null,
        policy,
      }),
    ).toEqual({ status: 'needs-review', reason: 'unknown-fba-fulfillable' });
  });
});

describe('AWD absence vs unknown', () => {
  const base = {
    fba: {
      fulfillableQuantity: 10,
      inboundWorkingQuantity: 0,
      inboundShippedQuantity: 0,
      inboundReceivingQuantity: 0,
    },
    svd: { quantity: 0 },
    svdUnitsPerBox: null,
    policy,
  };

  it('treats a SKU with no AWD row as zero units at AWD', () => {
    // AWD only lists what is stored there, so absence is a fact, not a gap.
    const result = calculateUsableSupply({ ...base, awd: null });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.breakdown.awdAvailable).toBe(0);
      expect(result.usableSupply).toBe(10);
    }
  });

  it('still flags an AWD row whose quantity is unknown', () => {
    // A row that exists but failed to parse is genuinely UNKNOWN and must not
    // silently become 0 — that is the invariant this project is built on.
    const result = calculateUsableSupply({
      ...base,
      awd: { availableQuantity: null, replenishmentQuantity: null },
    });
    expect(result).toEqual({
      status: 'needs-review',
      reason: 'unknown-awd-available',
    });
  });
});

describe('toUnits', () => {
  it('multiplies boxes by the pack size', () => {
    expect(toUnits(7, 60)).toBe(420);
  });

  it('returns zero boxes as zero units', () => {
    // Load-bearing: this is what lets a SKU with no SVD stock skip the factor
    // entirely rather than blocking on it.
    expect(toUnits(0, 60)).toBe(0);
  });
});

describe('SVD box to unit conversion', () => {
  // SVD reports BOXES; FBA and AWD report UNITS. Only SVD is converted.
  const base = {
    fba: {
      fulfillableQuantity: 10,
      inboundWorkingQuantity: 0,
      inboundShippedQuantity: 0,
      inboundReceivingQuantity: 0,
    },
    awd: { availableQuantity: 8, replenishmentQuantity: 0 },
    policy,
  };

  it('converts SVD boxes to units and leaves FBA and AWD untouched', () => {
    const result = calculateUsableSupply({
      ...base,
      svd: { quantity: 7 },
      svdUnitsPerBox: 60,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.breakdown.svdAvailable).toBe(420);
      expect(result.breakdown.fbaFulfillable).toBe(10);
      expect(result.breakdown.awdAvailable).toBe(8);
      expect(result.usableSupply).toBe(438);
    }
  });

  it('flags an unknown pack size when the SKU has SVD stock', () => {
    expect(
      calculateUsableSupply({ ...base, svd: { quantity: 7 }, svdUnitsPerBox: null }),
    ).toEqual({ status: 'needs-review', reason: 'unknown-svd-units-per-box' });
  });

  it('ignores an unknown pack size when SVD stock is zero', () => {
    // Zero boxes is zero units under every possible factor, so nothing is
    // unknown here — blocking would be noise, not safety.
    const result = calculateUsableSupply({
      ...base,
      svd: { quantity: 0 },
      svdUnitsPerBox: null,
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.usableSupply).toBe(18);
  });

  it('ignores an unknown pack size when the SKU is not carried at SVD', () => {
    const result = calculateUsableSupply({ ...base, svd: null, svdUnitsPerBox: null });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.usableSupply).toBe(18);
  });

  it('still flags an SVD row whose quantity is unreadable, pack size or not', () => {
    // Unknown quantity outranks the factor: we cannot convert what we cannot read.
    expect(
      calculateUsableSupply({ ...base, svd: { quantity: null }, svdUnitsPerBox: 60 }),
    ).toEqual({ status: 'needs-review', reason: 'unknown-svd-inventory' });
  });
});
