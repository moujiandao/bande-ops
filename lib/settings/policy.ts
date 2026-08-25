import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';

export type FulfillmentMode = 'fba_only';
export type SvdMode = 'replenishment_only';
export type ReviewMode = 'needs_review';
export const SVD_TO_FBA_TARGET_OPTIONS = [30, 60, 90, 180] as const;
export type SvdToFbaTargetDays = (typeof SVD_TO_FBA_TARGET_OPTIONS)[number];

export interface ReplenishmentPolicy {
  marketplaceId: string;
  velocitySampleInStockDays: number;
  velocityMaxLookbackDays: number;
  fulfillmentMode: FulfillmentMode;
  svdMode: SvdMode;
  unknownStockMode: ReviewMode;
  staleSourceMode: ReviewMode;
  svdToFbaTargetDays: SvdToFbaTargetDays;
  countAwdAvailable: boolean;
  countAwdReplenishment: boolean;
  countInboundWorking: boolean;
  countInboundShipped: boolean;
  countInboundReceiving: boolean;
}

export interface ReplenishmentPolicyInput {
  velocitySampleInStockDays: number;
  velocityMaxLookbackDays: number;
  svdToFbaTargetDays: number;
  countAwdAvailable: boolean;
  countAwdReplenishment: boolean;
  countInboundWorking: boolean;
  countInboundShipped: boolean;
  countInboundReceiving: boolean;
}

export interface ReplenishmentPolicyRow {
  marketplace_id: string;
  velocity_sample_in_stock_days: number;
  velocity_max_lookback_days: number;
  fulfillment_mode: FulfillmentMode;
  svd_mode: SvdMode;
  unknown_stock_mode: ReviewMode;
  stale_source_mode: ReviewMode;
  svd_to_fba_target_days: SvdToFbaTargetDays;
  count_awd_available: boolean | null;
  count_awd_replenishment: boolean | null;
  count_inbound_working: boolean;
  count_inbound_shipped: boolean;
  count_inbound_receiving: boolean;
}

export const REPLENISHMENT_POLICY_DEFAULTS: ReplenishmentPolicy = {
  marketplaceId: DEFAULT_MARKETPLACE.id,
  velocitySampleInStockDays: 90,
  velocityMaxLookbackDays: 365,
  fulfillmentMode: 'fba_only',
  svdMode: 'replenishment_only',
  unknownStockMode: 'needs_review',
  staleSourceMode: 'needs_review',
  svdToFbaTargetDays: 30,
  // AWD stock free to send to FBA is stock you own, so it counts. Units already
  // in transit to FBA do not, because FBA inbound may already report them.
  countAwdAvailable: true,
  countAwdReplenishment: false,
  countInboundWorking: false,
  countInboundShipped: true,
  countInboundReceiving: true,
};

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function validatePolicyInput(
  input: ReplenishmentPolicyInput,
): ReplenishmentPolicy {
  assertPositiveInteger('velocity sample days', input.velocitySampleInStockDays);
  assertPositiveInteger('velocity max lookback days', input.velocityMaxLookbackDays);
  if (input.velocitySampleInStockDays > input.velocityMaxLookbackDays) {
    throw new Error('velocity sample days must be <= max lookback days');
  }
  if (!SVD_TO_FBA_TARGET_OPTIONS.includes(input.svdToFbaTargetDays as SvdToFbaTargetDays)) {
    throw new Error('SVD to FBA target days must be one of 30, 60, 90, 180');
  }
  return {
    ...REPLENISHMENT_POLICY_DEFAULTS,
    ...input,
    svdToFbaTargetDays: input.svdToFbaTargetDays as SvdToFbaTargetDays,
  };
}

export function mapPolicyRow(
  row: ReplenishmentPolicyRow | null,
): ReplenishmentPolicy {
  if (!row) return REPLENISHMENT_POLICY_DEFAULTS;
  return {
    marketplaceId: row.marketplace_id,
    velocitySampleInStockDays: row.velocity_sample_in_stock_days,
    velocityMaxLookbackDays: row.velocity_max_lookback_days,
    fulfillmentMode: row.fulfillment_mode,
    svdMode: row.svd_mode,
    unknownStockMode: row.unknown_stock_mode,
    staleSourceMode: row.stale_source_mode,
    svdToFbaTargetDays:
      row.svd_to_fba_target_days ?? REPLENISHMENT_POLICY_DEFAULTS.svdToFbaTargetDays,
    countAwdAvailable: row.count_awd_available ?? true,
    countAwdReplenishment: row.count_awd_replenishment ?? false,
    countInboundWorking: row.count_inbound_working,
    countInboundShipped: row.count_inbound_shipped,
    countInboundReceiving: row.count_inbound_receiving,
  };
}
