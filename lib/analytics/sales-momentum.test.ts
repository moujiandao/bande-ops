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

describe('confirmed Vine adjustment (domain inputs, not Amazon fixtures)', () => {
  const options = { windowDays: 7, historyDays: 90, excludeVine: true } as const;
  const vineDay = (date: string, shipments: number, vine: number | null,
    start: number | null = 100, end: number | null = 100) =>
    day(date, shipments, start, end, { confirmedVineUnits: vine });

  it('keeps raw facts and stocked Vine-only days in the denominator', () => {
    const rows = dates(7).map((date) => vineDay(date, 4, 4));
    const result = calculateSalesMomentum(rows, options);
    expect(result.recent).toMatchObject({
      eligibleDays: 7, unitsShipped: 0, totalShipments: 28,
      excludedVineUnits: 28, dailyVelocity: 0,
    });
    expect(result.days[0]).toMatchObject({
      customerShipments: 4, startingBalance: 100, endingBalance: 100,
      observedUnits: 0, eligible: true,
    });
    expect(rows[0].customerShipments).toBe(4);
  });

  it('includes the non-Vine portion of a genuine sellout day', () => {
    expect(classifySalesDay(vineDay('2026-08-01', 10, 4, 10, 0), true)).toMatchObject({
      observedUnits: 6, excludedVineUnits: 4,
      classification: 'eligible-possible-sellout', eligible: true,
    });
  });

  it('retains non-Vine shipment evidence even when opening and closing stock are zero', () => {
    expect(classifySalesDay(vineDay('2026-08-01', 10, 4, 0, 0), true)).toMatchObject({
      observedUnits: 6, eligible: true,
    });
  });

  it.each([[null, null], [0, 0], [null, 0]] as const)(
    'does not turn Vine-only activity with stock %s/%s into an eligible or skippable day',
    (start, end) => {
      expect(classifySalesDay(vineDay('2026-08-01', 4, 4, start, end), true)).toMatchObject({
        classification: 'unknown', eligible: false, adjustmentIssue: 'ambiguous-stock',
      });
    },
  );

  it('still skips a known stockout with confirmed zero Vine', () => {
    expect(classifySalesDay(vineDay('2026-08-01', 0, 0, 0, 0), true)).toMatchObject({
      classification: 'out-of-stock', eligible: false,
    });
  });

  it.each([undefined, null])('does not treat missing coverage %s as zero Vine', (vine) => {
    expect(classifySalesDay(day('2026-08-01', 4, 100, 100, { confirmedVineUnits: vine }), true))
      .toMatchObject({ classification: 'unknown', observedUnits: null, adjustmentIssue: 'unavailable' });
  });

  it.each([-1, 5, 0.5, NaN, Infinity])('rejects impossible adjustments %s without clamping', (vine) => {
    expect(classifySalesDay(vineDay('2026-08-01', 4, vine), true)).toMatchObject({
      classification: 'unknown', observedUnits: null, adjustmentIssue: 'reconciliation-error',
    });
  });

  it('does not bridge missing Vine evidence between otherwise eligible periods', () => {
    const rows = dates(13).map((date, index) => vineDay(date, 4, index === 6 ? null : 1));
    const result = calculateSalesMomentum(rows, options);
    expect(result.best).toBeNull();
    expect(result.recent).toBeNull();
    expect(result.early).toMatchObject({ eligibleDays: 6, unitsShipped: 18, excludedVineUnits: 6 });
  });

  it('recomputes recent, previous, best dates, and trend on one consistent basis', () => {
    const rows = dates(14).map((date, index) => vineDay(date, index < 7 ? 10 : 4, index < 7 ? 9 : 0));
    const result = calculateSalesMomentum(rows, options);
    expect(result.previous).toMatchObject({ dailyVelocity: 1, excludedVineUnits: 63 });
    expect(result.recent).toMatchObject({ dailyVelocity: 4, excludedVineUnits: 0 });
    expect(result.best).toMatchObject({ startDate: '2026-08-08', endDate: '2026-08-14' });
    expect(result.percentageChange).toBe(300);
    expect(result.trend).toBe('trending-up');
  });

  it('preserves the all-shipment result when the toggle is off, even with bad Vine evidence', () => {
    const raw = dates(14).map((date) => day(date, 4, 100, 100));
    const unverified = raw.map((row) => ({ ...row, confirmedVineUnits: -100 }));
    const result = calculateSalesMomentum(unverified, { ...options, excludeVine: false });
    const original = calculateSalesMomentum(raw, { ...options, excludeVine: false });
    expect(result.recent).toEqual(original.recent);
    expect(result.previous).toEqual(original.previous);
    expect(result.best).toEqual(original.best);
    expect(result.trend).toEqual(original.trend);
  });
});
