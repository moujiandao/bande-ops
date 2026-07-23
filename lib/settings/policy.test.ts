import { describe, expect, it } from 'vitest';
import {
  REPLENISHMENT_POLICY_DEFAULTS,
  mapPolicyRow,
  validatePolicyInput,
} from './policy';

describe('replenishment policy', () => {
  it('defaults to approved global reorder behavior', () => {
    expect(REPLENISHMENT_POLICY_DEFAULTS).toEqual({
      marketplaceId: 'ATVPDKIKX0DER',
      velocitySampleInStockDays: 90,
      velocityMaxLookbackDays: 365,
      fulfillmentMode: 'fba_only',
      svdMode: 'replenishment_only',
      unknownStockMode: 'needs_review',
      staleSourceMode: 'needs_review',
      countAwdAvailable: true,
      countAwdReplenishment: false,
      countInboundWorking: false,
      countInboundShipped: true,
      countInboundReceiving: true,
    });
  });

  it('maps a missing DB row to defaults', () => {
    expect(mapPolicyRow(null)).toEqual(REPLENISHMENT_POLICY_DEFAULTS);
  });

  it('rejects sample days greater than lookback days', () => {
    expect(() =>
      validatePolicyInput({
        velocitySampleInStockDays: 366,
        velocityMaxLookbackDays: 365,
        countAwdAvailable: true,
        countAwdReplenishment: false,
        countInboundWorking: false,
        countInboundShipped: true,
        countInboundReceiving: true,
      }),
    ).toThrow('velocity sample days must be <= max lookback days');
  });
});
