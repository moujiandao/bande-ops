export interface VelocityInputDay {
  activityDate: string;
  customerShipments: number;
  isInStock: boolean;
}

export interface VelocityPolicy {
  sampleInStockDays: number;
  maxLookbackDays: number;
}

export type SalesVelocityResult =
  | {
      status: 'ok';
      unitsShipped: number;
      inStockSampleDays: number;
      lookbackDaysUsed: number;
      dailyVelocity: number;
    }
  | {
      status: 'unknown';
      unitsShipped: null;
      inStockSampleDays: number;
      lookbackDaysUsed: number;
      dailyVelocity: null;
    };

export function calculateSalesVelocity(
  inputRows: VelocityInputDay[],
  policy: VelocityPolicy,
): SalesVelocityResult {
  const bounded = [...inputRows]
    .sort((a, b) => b.activityDate.localeCompare(a.activityDate))
    .slice(0, policy.maxLookbackDays);
  const sampled = bounded
    .filter((row) => row.isInStock)
    .slice(0, policy.sampleInStockDays);

  if (sampled.length === 0) {
    return {
      status: 'unknown',
      unitsShipped: null,
      inStockSampleDays: 0,
      lookbackDaysUsed: bounded.length,
      dailyVelocity: null,
    };
  }

  const unitsShipped = sampled.reduce(
    (sum, row) => sum + row.customerShipments,
    0,
  );

  return {
    status: 'ok',
    unitsShipped,
    inStockSampleDays: sampled.length,
    lookbackDaysUsed: bounded.length,
    dailyVelocity: unitsShipped / sampled.length,
  };
}
