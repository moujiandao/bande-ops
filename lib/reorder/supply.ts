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
  /** SVD quantities are BOXES, not units. See `svdUnitsPerBox`. */
  svd: { quantity: number | null } | null;
  /**
   * Sellable units per SVD box for this SKU, or null when we do not know it.
   *
   * Required rather than optional on purpose: every caller must decide what to
   * pass. An optional field would let a call site omit it and silently get the
   * old, wrong behaviour — and vitest transpiles without typechecking, so only
   * `npm run build` would ever notice.
   */
  svdUnitsPerBox: number | null;
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

/**
 * The single box-to-unit conversion in the codebase.
 *
 * SVD is the only box-denominated source; FBA and AWD already report units and
 * must never be passed through here.
 */
export function toUnits(boxes: number, unitsPerBox: number): number {
  return boxes * unitsPerBox;
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
  const svdBoxes =
    input.svd === null
      ? 0
      : required(input.svd.quantity, 'unknown-svd-inventory');
  if (typeof svdBoxes === 'string') {
    return { status: 'needs-review', reason: svdBoxes };
  }

  // SVD counts BOXES. Converting needs a per-SKU pack size, and an unknown one
  // must never default to 1 — that is precisely the bug this fixes.
  //
  // The factor only matters when there is stock to convert: zero boxes is zero
  // units under every possible pack size, so a SKU not stocked at SVD passes
  // through unblocked. That is exact, not a leniency.
  let svdAvailable = 0;
  if (svdBoxes > 0) {
    const unitsPerBox = input.svdUnitsPerBox;
    // Checks undefined as well as null. The type forbids undefined, but vitest
    // transpiles without typechecking and a missed field would otherwise
    // multiply into NaN and poison the supply total silently.
    if (unitsPerBox === null || unitsPerBox === undefined) {
      return { status: 'needs-review', reason: 'unknown-svd-units-per-box' };
    }
    svdAvailable = toUnits(svdBoxes, unitsPerBox);
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
