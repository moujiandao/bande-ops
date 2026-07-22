import { describe, expect, it } from 'vitest';
import { calculateUsableSupply } from './supply';

const policy = {
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
        awd: { replenishmentQuantity: 8 },
        svd: { quantity: 7 },
        policy,
      }),
    ).toMatchObject({
      status: 'ok',
      usableSupply: 30,
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
        awd: { replenishmentQuantity: 0 },
        svd: { quantity: 0 },
        policy,
      }),
    ).toEqual({ status: 'needs-review', reason: 'unknown-fba-fulfillable' });
  });
});
