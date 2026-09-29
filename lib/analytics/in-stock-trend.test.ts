import { describe, expect, it } from 'vitest';
import {
  calculateInStockTrend,
  classifySalesDay,
  type SalesLedgerDay,
} from './in-stock-trend';

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
  it('includes a confirmed sellout day and a stocked zero-sales day', () => {
    expect(classifySalesDay(day('2026-08-01', 40, 40, 0))).toMatchObject({
      eligible: true,
      classification: 'eligible-possible-sellout',
    });
    expect(classifySalesDay(day('2026-08-02', 0, 40, 40))).toMatchObject({
      eligible: true,
      classification: 'eligible-stocked',
    });
  });

  it('excludes stockouts, invalid shipments, and shipment-only evidence', () => {
    expect(classifySalesDay(day('2026-08-01', 0, 0, 0))).toMatchObject({
      eligible: false,
      classification: 'out-of-stock',
    });
    expect(
      classifySalesDay(
        day('2026-08-02', 0, 40, 40, { customerShipmentsValid: false }),
      ),
    ).toMatchObject({ eligible: false, classification: 'unknown' });
    expect(classifySalesDay(day('2026-08-03', 3, null, 0))).toMatchObject({
      eligible: false,
      classification: 'shipment-only-evidence',
    });
  });
});

describe('calculateInStockTrend', () => {
  it('measures robust growth inside one continuous stocked run', () => {
    const shipments = [1, 2, 2, 4, 5, 6, 7];
    const result = calculateInStockTrend(
      dates(7).map((date, index) => day(date, shipments[index], 100, 90)),
      { windowDays: 7, historyDays: 90, analysisDate: '2026-08-07' },
    );

    expect(result.trend).toBe('growing');
    expect(result.latestRun).toMatchObject({
      startDate: '2026-08-01',
      endDate: '2026-08-07',
      eligibleDays: 7,
      startVelocity: 5 / 3,
      endVelocity: 6,
      direction: 'growing',
    });
    expect(result.latestRun?.slopePerDay).toBeGreaterThan(0.8);
  });

  it('does not let one outlier dominate a stable run', () => {
    const shipments = [4, 4, 4, 30, 4, 4, 4];
    const result = calculateInStockTrend(
      dates(7).map((date, index) => day(date, shipments[index], 100, 90)),
      { windowDays: 7, historyDays: 90, analysisDate: '2026-08-07' },
    );

    expect(result.latestRun?.slopePerDay).toBe(0);
    expect(result.trend).toBe('stable');
  });

  it('splits runs at stockouts and never bridges the gap', () => {
    const rows = [
      ...dates(5).map((date, index) => day(date, index + 1, 20, 10)),
      day('2026-08-06', 0, 0, 0),
      ...dates(5, '2026-08-07').map((date, index) =>
        day(date, 10 - index, index === 0 ? 0 : 20, 20),
      ),
    ];
    const result = calculateInStockTrend(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-11',
    });

    expect(result.runs).toHaveLength(2);
    expect(result.latestRun?.startDate).toBe('2026-08-07');
    expect(result.trend).toBe('declining');
  });

  it('includes the sellout day once and labels a short run quick sellout', () => {
    const result = calculateInStockTrend(
      [
        day('2026-08-01', 2, 10, 8),
        day('2026-08-02', 3, 8, 5),
        day('2026-08-03', 5, 5, 0),
        day('2026-08-04', 0, 0, 0),
      ],
      { windowDays: 7, historyDays: 90, analysisDate: '2026-08-04' },
    );

    expect(result.latestRun).toMatchObject({
      eligibleDays: 3,
      unitsShipped: 10,
      endedInSellout: true,
    });
    expect(result.trend).toBe('quick-sellout');
    expect(result.stockoutConstrained).toBe(true);
  });

  it('splits at unknown, missing, restock, and shipment-only days', () => {
    const rows = [
      day('2026-08-01', 2, 10, 8),
      day('2026-08-02', 0, 8, 8, { customerShipmentsValid: false }),
      day('2026-08-04', 3, 0, 10),
      day('2026-08-05', 3, null, null),
      day('2026-08-06', 4, 10, 6),
    ];
    const result = calculateInStockTrend(rows, {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-06',
    });

    expect(result.runs.map((run) => run.eligibleDays)).toEqual([1, 1, 1]);
    expect(result.days[3].classification).toBe('shipment-only-evidence');
  });

  it('caps each analyzed run at the selected recent in-stock window', () => {
    const result = calculateInStockTrend(
      dates(14).map((date, index) => day(date, index + 1, 100, 90)),
      { windowDays: 7, historyDays: 90, analysisDate: '2026-08-14' },
    );

    expect(result.latestRun).toMatchObject({
      startDate: '2026-08-08',
      endDate: '2026-08-14',
      fullRunDays: 14,
      eligibleDays: 7,
    });
  });

  it('reports repeated-run consistency and high confidence', () => {
    const first = dates(7).map((date, index) => day(date, index + 1, 30, 20));
    const second = dates(7, '2026-08-10').map((date, index) =>
      day(date, index + 2, index === 0 ? 0 : 30, index === 6 ? 0 : 20),
    );
    const result = calculateInStockTrend([...first, ...second], {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-16',
    });

    expect(result.growingRuns).toBe(2);
    expect(result.qualifyingRuns).toBe(2);
    expect(result.confidence).toBe('high');
  });

  it('finds the best complete sustained window wholly inside a stocked run', () => {
    const first = dates(7).map((date) => day(date, 2, 30, 20));
    const second = dates(7, '2026-08-10').map((date) => day(date, 6, 30, 20));
    const result = calculateInStockTrend([...first, second[0], ...second.slice(1)], {
      windowDays: 7,
      historyDays: 90,
      analysisDate: '2026-08-16',
    });

    expect(result.best).toMatchObject({
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      dailyVelocity: 6,
    });
  });

  it('labels old run evidence historical', () => {
    const result = calculateInStockTrend(
      dates(7).map((date, index) => day(date, index + 1, 100, 90)),
      { windowDays: 7, historyDays: 90, analysisDate: '2026-09-10' },
    );

    expect(result.trend).toBe('historical-only');
    expect(result.confidence).toBe('none');
  });
});
