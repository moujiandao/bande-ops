export interface SupplyPolicy {
  countInboundWorking: boolean;
  countInboundShipped: boolean;
  countInboundReceiving: boolean;
  /** Stock at AWD free to send to FBA. On by default: it is stock you own. */
  countAwdAvailable: boolean;
  /**
   * Stock already in transit from AWD to FBA. Off by default: FBA's own inbound
   * buckets may already report these units, and counting both double-counts
   * them, inflating supply and under-ordering.
   */
  countAwdReplenishment: boolean;
}

export interface SupplyInput {
  fba: {
    fulfillableQuantity: number | null;
    inboundWorkingQuantity: number | null;
    inboundShippedQuantity: number | null;
    inboundReceivingQuantity: number | null;
  } | null;
  awd: {
    availableQuantity: number | null;
    replenishmentQuantity: number | null;
  } | null;
  svd: { quantity: number | null } | null;
  policy: SupplyPolicy;
}

export type UsableSupplyResult =
  | {
      status: 'ok';
      usableSupply: number;
      breakdown: {
        fbaFulfillable: number;
        fbaInboundWorking: number;
        fbaInboundShipped: number;
        fbaInboundReceiving: number;
        awdAvailable: number;
        awdReplenishment: number;
        svdAvailable: number;
      };
    }
  | { status: 'needs-review'; reason: string };

function required(
  value: number | null | undefined,
  reason: string,
): number | string {
  return value === null || value === undefined ? reason : value;
}

export function calculateUsableSupply(input: SupplyInput): UsableSupplyResult {
  if (!input.fba) return { status: 'needs-review', reason: 'missing-fba-inventory' };

  const fbaFulfillable = required(
    input.fba.fulfillableQuantity,
    'unknown-fba-fulfillable',
  );
  if (typeof fbaFulfillable === 'string') {
    return { status: 'needs-review', reason: fbaFulfillable };
  }

  const fbaInboundWorking = input.policy.countInboundWorking
    ? required(input.fba.inboundWorkingQuantity, 'unknown-fba-inbound-working')
    : 0;
  if (typeof fbaInboundWorking === 'string') {
    return { status: 'needs-review', reason: fbaInboundWorking };
  }

  const fbaInboundShipped = input.policy.countInboundShipped
    ? required(input.fba.inboundShippedQuantity, 'unknown-fba-inbound-shipped')
    : 0;
  if (typeof fbaInboundShipped === 'string') {
    return { status: 'needs-review', reason: fbaInboundShipped };
  }

  const fbaInboundReceiving = input.policy.countInboundReceiving
    ? required(input.fba.inboundReceivingQuantity, 'unknown-fba-inbound-receiving')
    : 0;
  if (typeof fbaInboundReceiving === 'string') {
    return { status: 'needs-review', reason: fbaInboundReceiving };
  }

  // A missing AWD row means the SKU simply is not stored at AWD — absence is a
  // fact, so it contributes 0. A row that EXISTS with an unreadable quantity is
  // genuinely UNKNOWN and must still block, per the unknown-vs-zero rule.
  const awdAvailable = !input.policy.countAwdAvailable
    ? 0
    : input.awd === null
      ? 0
      : required(input.awd.availableQuantity, 'unknown-awd-available');
  if (typeof awdAvailable === 'string') {
    return { status: 'needs-review', reason: awdAvailable };
  }

  const awdReplenishment = !input.policy.countAwdReplenishment
    ? 0
    : input.awd === null
      ? 0
      : required(input.awd.replenishmentQuantity, 'unknown-awd-replenishment');
  if (typeof awdReplenishment === 'string') {
    return { status: 'needs-review', reason: awdReplenishment };
  }

  // Same distinction for SVD: the SKU mapped (a missing mapping is caught
  // earlier) but the item is not carried there, so it contributes 0. A carried
  // item with an unreadable quantity still blocks.
  const svdAvailable =
    input.svd === null
      ? 0
      : required(input.svd.quantity, 'unknown-svd-inventory');
  if (typeof svdAvailable === 'string') {
    return { status: 'needs-review', reason: svdAvailable };
  }

  const breakdown = {
    fbaFulfillable,
    fbaInboundWorking,
    fbaInboundShipped,
    fbaInboundReceiving,
    awdAvailable,
    awdReplenishment,
    svdAvailable,
  };

  return {
    status: 'ok',
    usableSupply: Object.values(breakdown).reduce((sum, value) => sum + value, 0),
    breakdown,
  };
}
