import { describe, expect, it } from 'vitest';
import { calculateSalesVelocity } from './calculate';

describe('calculateSalesVelocity', () => {
  it('uses recent in-stock days and skips out-of-stock days', () => {
    expect(
      calculateSalesVelocity(
        [
          { activityDate: '2026-07-21', customerShipments: 3, isInStock: true },
          { activityDate: '2026-07-20', customerShipments: 99, isInStock: false },
          { activityDate: '2026-07-19', customerShipments: 5, isInStock: true },
        ],
        { sampleInStockDays: 2, maxLookbackDays: 365 },
      ),
    ).toEqual({
      status: 'ok',
      unitsShipped: 8,
      inStockSampleDays: 2,
      lookbackDaysUsed: 3,
      dailyVelocity: 4,
    });
  });

  it('returns unknown when no days were in stock', () => {
    expect(
      calculateSalesVelocity(
        [{ activityDate: '2026-07-21', customerShipments: 7, isInStock: false }],
        { sampleInStockDays: 90, maxLookbackDays: 365 },
      ),
    ).toEqual({
      status: 'unknown',
      unitsShipped: null,
      inStockSampleDays: 0,
      lookbackDaysUsed: 1,
      dailyVelocity: null,
    });
  });
}
);
