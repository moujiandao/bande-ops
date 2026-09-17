import { describe, expect, it } from 'vitest';
import {
  calculateSalesMomentum,
  classifySalesDay,
  type SalesLedgerDay,
} from './sales-momentum';

function day(
  activityDate: string,
  shipments: number,
  start: number | null,
  end: number | null,
  overrides: Partial<SalesLedgerDay> = {},
): SalesLedgerDay {
  return {
    activityDate,
    customerShipments: shipments,
    customerShipmentsValid: true,
    startingBalance: start,
    startingBalanceValid: start !== null,
    endingBalance: end,
    endingBalanceValid: end !== null,
    ...overrides,
  };
}

function dates(count: number, start = '2026-08-01'): string[] {
  const first = Date.parse(`${start}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(first + index * 86_400_000).toISOString().slice(0, 10),
  );
}

describe('classifySalesDay', () => {
  it('includes a shipment day that ends with zero inventory and flags it', () => {
    expect(classifySalesDay(day('2026-08-01', 40, 40, 0))).toMatchObject({
      eligible: true,
      classification: 'eligible-possible-sellout',
    });
  });

  it('includes a stocked zero-sales day in the denominator', () => {
    expect(classifySalesDay(day('2026-08-01', 0, 40, 40))).toMatchObject({
      eligible: true,
      classification: 'eligible-stocked',
    });
  });

  it('excludes a known zero-stock zero-shipment day', () => {
    expect(classifySalesDay(day('2026-08-01', 0, 0, 0))).toMatchObject({
      eligible: false,
      classification: 'out-of-stock',
    });
  });

  it('keeps an unreadable shipment count unknown even with inventory', () => {
    expect(
      classifySalesDay(
        day('2026-08-01', 0, 40, 40, {
          customerShipmentsValid: false,
        }),
      ),
    ).toMatchObject({ eligible: false, classification: 'unknown' });
  });

  it('accepts positive shipments from pre-migration rows as shipment evidence', () => {
    expect(
      classifySalesDay(
        day('2026-08-01', 3, null, 0, {
          customerShipmentsValid: null,
          endingBalanceValid: null,
        }),
      ),
    ).toMatchObject({
      eligible: true,
      classification: 'eligible-shipment-evidence',
    });
  });
});

describe('calculateSalesMomentum', () => {
  it('counts a sellout day once and excludes the following inactive stockout day', () => {
    const result = calculateSalesMomentum(
      [
        day('2026-08-01', 10, 50, 40),
        day('2026-08-02', 40, 40, 0),
        day('2026-08-03', 0, 0, 0),
      ],
      { windowDays: 7, historyDays: 90, analysisDate: '2026-08-03' },
    );

    expect(result.early).toBeNull();
    expect(result.days.map((row) => row.classification)).toEqual([
      'eligible-stocked',
      'eligible-possible-sellout',
      'out-of-stock',
    ]);

    const twoDay = calculateSalesMomentum(
      [
        day('2026-08-01', 10, 50, 40),
        day('2026-08-02', 40, 40, 0),
      ],
      { windowDays: 7, historyDays: 90, analysisDate: '2026-08-02' },
    );
    expect(twoDay.days.filter((row) => row.eligible)).toHaveLength(2);
    expect(
      twoDay.days
        .filter((row) => row.eligible)
        .reduce((sum, row) => sum + row.customerShipments, 0) / 2,
    ).toBe(25);
  });

  it('compares recent and previous equal-size periods and labels growth', () => {
    const rows = dates(14).map((date, index) =>
      day(date, index < 7 ? 2 : 4, 100, 100),
    );
    const result = calculateSalesMomentum(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-14',
    });

    expect(result.previous).toMatchObject({ unitsShipped: 14, dailyVelocity: 2 });
    expect(result.recent).toMatchObject({ unitsShipped: 28, dailyVelocity: 4 });
    expect(result.absoluteChange).toBe(2);
    expect(result.percentageChange).toBe(100);
    expect(result.trend).toBe('trending-up');
  });

  it('distinguishes complete stocked windows with no observed shipments', () => {
    const rows = dates(14).map((date) => day(date, 0, 100, 100));
    const result = calculateSalesMomentum(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-14',
    });

    expect(result.recent?.unitsShipped).toBe(0);
    expect(result.previous?.unitsShipped).toBe(0);
    expect(result.trend).toBe('no-observed-shipments');
  });

  it('keeps an absolute change when activity starts from a zero baseline', () => {
    const rows = dates(14).map((date, index) =>
      day(date, index < 7 ? 0 : 3, 100, 100),
    );
    const result = calculateSalesMomentum(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-14',
    });

    expect(result.trend).toBe('new-activity');
    expect(result.absoluteChange).toBe(3);
    expect(result.percentageChange).toBeNull();
  });

  it('reports known stockout days skipped inside a qualifying period', () => {
    const rows = dates(8).map((date, index) =>
      index === 3 ? day(date, 0, 0, 0) : day(date, 2, 100, 100),
    );
    const result = calculateSalesMomentum(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-08',
    });

    expect(result.recent).toMatchObject({
      eligibleDays: 7,
      calendarDays: 8,
      excludedStockoutDays: 1,
    });
  });

  it('detects sustained growth across three complete periods', () => {
    const rows = dates(21).map((date, index) =>
      day(date, index < 7 ? 1 : index < 14 ? 2 : 4, 100, 100),
    );
    const result = calculateSalesMomentum(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-21',
    });

    expect(result.trend).toBe('sustained-growth');
  });

  it('shows a provisional early pace from three to six eligible days', () => {
    const rows = dates(5).map((date) => day(date, 6, 30, 20));
    const result = calculateSalesMomentum(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-05',
    });

    expect(result.early).toMatchObject({
      eligibleDays: 5,
      unitsShipped: 30,
      dailyVelocity: 6,
    });
    expect(result.trend).toBe('early-launch');
  });

  it('finds the best rolling period and keeps its exact dates', () => {
    const shipments = [1, 1, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8];
    const rows = dates(14).map((date, index) =>
      day(date, shipments[index], 100, 100),
    );
    const result = calculateSalesMomentum(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-14',
    });

    expect(result.best).toMatchObject({
      startDate: '2026-08-08',
      endDate: '2026-08-14',
      unitsShipped: 35,
      dailyVelocity: 5,
    });
  });

  it('does not bridge an unknown or missing-data gap', () => {
    const rows = [
      ...dates(6).map((date) => day(date, 5, 20, 20)),
      day('2026-08-07', 0, 20, 20, { customerShipmentsValid: false }),
      ...dates(6, '2026-08-08').map((date) => day(date, 6, 20, 20)),
    ];
    const result = calculateSalesMomentum(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-13',
    });

    expect(result.recent).toBeNull();
    expect(result.early?.eligibleDays).toBe(6);
    expect(result.best).toBeNull();
  });

  it('marks an old complete sample historical instead of currently trending', () => {
    const rows = dates(14).map((date, index) =>
      day(date, index < 7 ? 2 : 4, 100, 100),
    );
    const result = calculateSalesMomentum(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-09-10',
    });

    expect(result.trend).toBe('historical-only');
  });

  it('marks an old provisional sample historical instead of an early launch', () => {
    const rows = dates(5).map((date) => day(date, 6, 30, 20));
    const result = calculateSalesMomentum(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-09-10',
    });

    expect(result.early?.eligibleDays).toBe(5);
    expect(result.trend).toBe('historical-only');
  });

  it('does not compare complete windows spread across more than 90 days', () => {
    const rows = dates(181, '2026-01-01').map((date, index) =>
      index % 3 === 0
        ? day(date, index < 99 ? 2 : 4, 100, 100)
        : day(date, 0, 0, 0),
    );
    const result = calculateSalesMomentum(rows, {
      windowDays: 28,
      historyDays: 365,
      analysisDate: '2026-06-30',
    });

    expect(result.recent).not.toBeNull();
    expect(result.previous).toBeNull();
    expect(result.percentageChange).toBeNull();
  });
});
