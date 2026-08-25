import { describe, expect, it } from 'vitest';
import {
  REPLENISHMENT_POLICY_DEFAULTS,
  mapPolicyRow,
  validatePolicyInput,
  type ReplenishmentPolicyRow,
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
      svdToFbaTargetDays: 30,
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

  it('maps the persisted SVD-to-FBA target', () => {
    const row: ReplenishmentPolicyRow = {
      marketplace_id: 'ATVPDKIKX0DER',
      velocity_sample_in_stock_days: 90,
      velocity_max_lookback_days: 365,
      fulfillment_mode: 'fba_only',
      svd_mode: 'replenishment_only',
      unknown_stock_mode: 'needs_review',
      stale_source_mode: 'needs_review',
      svd_to_fba_target_days: 60,
      count_awd_available: true,
      count_awd_replenishment: false,
      count_inbound_working: false,
      count_inbound_shipped: true,
      count_inbound_receiving: true,
    };

    expect(mapPolicyRow(row).svdToFbaTargetDays).toBe(60);
  });

  it.each([30, 60, 90, 180])('accepts %i days as an SVD-to-FBA target', (days) => {
    const policy = validatePolicyInput({
      velocitySampleInStockDays: 90,
      velocityMaxLookbackDays: 365,
      svdToFbaTargetDays: days,
      countAwdAvailable: true,
      countAwdReplenishment: false,
      countInboundWorking: false,
      countInboundShipped: true,
      countInboundReceiving: true,
    });

    expect(policy.svdToFbaTargetDays).toBe(days);
  });

  it('rejects an unsupported SVD-to-FBA target', () => {
    expect(() =>
      validatePolicyInput({
        velocitySampleInStockDays: 90,
        velocityMaxLookbackDays: 365,
        svdToFbaTargetDays: 45,
        countAwdAvailable: true,
        countAwdReplenishment: false,
        countInboundWorking: false,
        countInboundShipped: true,
        countInboundReceiving: true,
      }),
    ).toThrow('SVD to FBA target days must be one of 30, 60, 90, 180');
  });

  it('rejects sample days greater than lookback days', () => {
    expect(() =>
      validatePolicyInput({
        velocitySampleInStockDays: 366,
        velocityMaxLookbackDays: 365,
        svdToFbaTargetDays: 30,
        countAwdAvailable: true,
        countAwdReplenishment: false,
        countInboundWorking: false,
        countInboundShipped: true,
        countInboundReceiving: true,
      }),
    ).toThrow('velocity sample days must be <= max lookback days');
  });
});
