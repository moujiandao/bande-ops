export const ANALYTICS_WINDOW_OPTIONS = [7, 14, 28] as const;
export type AnalyticsWindowDays = (typeof ANALYTICS_WINDOW_OPTIONS)[number];

export const ANALYTICS_HISTORY_OPTIONS = [90, 180, 365] as const;
export type AnalyticsHistoryDays = (typeof ANALYTICS_HISTORY_OPTIONS)[number];

export interface SalesLedgerDay {
  activityDate: string;
  customerShipments: number;
  customerShipmentsValid: boolean | null;
  startingBalance: number | null;
  startingBalanceValid: boolean | null;
  endingBalance: number | null;
  endingBalanceValid: boolean | null;
  /** Only populated from complete, reconciled evidence for this ledger day. */
  confirmedVineUnits?: number | null;
}

export type SalesDayClassification =
  | 'eligible-stocked'
  | 'eligible-possible-sellout'
  | 'eligible-restock'
  | 'eligible-shipment-evidence'
  | 'out-of-stock'
  | 'unknown';

export interface ClassifiedSalesDay extends SalesLedgerDay {
  classification: SalesDayClassification;
  eligible: boolean;
  observedUnits: number | null;
  excludedVineUnits: number | null;
  adjustmentIssue: 'unavailable' | 'reconciliation-error' | 'ambiguous-stock' | null;
}

export interface VelocityPeriod {
  startDate: string;
  endDate: string;
  eligibleDays: number;
  calendarDays: number;
  unitsShipped: number;
  totalShipments: number;
  excludedVineUnits: number;
  dailyVelocity: number;
  possibleSelloutDays: number;
  restockDays: number;
  shipmentEvidenceOnlyDays: number;
  /** Known zero-stock days skipped between the first and last eligible day. */
  excludedStockoutDays: number;
}

export type TrendKind =
  | 'sustained-growth'
  | 'trending-up'
  | 'trending-down'
  | 'stable'
  | 'new-activity'
  | 'no-observed-shipments'
  | 'limited-volume'
  | 'early-launch'
  | 'historical-only'
  | 'insufficient-data';

export interface SalesMomentumResult {
  days: ClassifiedSalesDay[];
  recent: VelocityPeriod | null;
  previous: VelocityPeriod | null;
  older: VelocityPeriod | null;
  early: VelocityPeriod | null;
  best: VelocityPeriod | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  trend: TrendKind;
  dataThroughDate: string | null;
}

export interface SalesMomentumOptions {
  windowDays: AnalyticsWindowDays;
  historyDays: AnalyticsHistoryDays;
  /** Latest completed ledger date across the dataset. Defaults to this SKU's latest row. */
  analysisDate?: string;
  excludeVine?: boolean;
}

const MS_PER_DAY = 86_400_000;

function utcDay(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function dayDifference(earlier: string, later: string): number {
  return Math.round((utcDay(later) - utcDay(earlier)) / MS_PER_DAY);
}

function dateMinusDays(date: string, days: number): string {
  return new Date(utcDay(date) - days * MS_PER_DAY).toISOString().slice(0, 10);
}

function positiveKnownBalance(value: number | null, valid: boolean | null): boolean {
  return valid === true && value !== null && value > 0;
}

function zeroKnownBalance(value: number | null, valid: boolean | null): boolean {
  return valid === true && value === 0;
}

/**
 * Classify one completed ledger day without inventing stock or shipment facts.
 * Positive shipments from pre-migration rows remain valid evidence because the
 * old parser could only produce a positive number from a parseable source cell.
 * A stored zero with null validity stays unknown until the source is reprocessed.
 */
export function classifySalesDay(
  day: SalesLedgerDay,
  excludeVine = false,
): ClassifiedSalesDay {
  const excludedVineUnits = excludeVine ? day.confirmedVineUnits ?? null : 0;
  const validAdjustment = excludedVineUnits !== null &&
    Number.isSafeInteger(excludedVineUnits) && excludedVineUnits >= 0 &&
    excludedVineUnits <= day.customerShipments;
  const classified = {
    ...day,
    observedUnits: validAdjustment ? day.customerShipments - excludedVineUnits : null,
    excludedVineUnits: validAdjustment ? excludedVineUnits : null,
    adjustmentIssue: (excludedVineUnits === null ? 'unavailable' : validAdjustment ? null : 'reconciliation-error') as ClassifiedSalesDay['adjustmentIssue'],
  };
  if (!validAdjustment) {
    return { ...classified, classification: 'unknown', eligible: false };
  }
  const shipmentsKnown =
    day.customerShipmentsValid === true ||
    (day.customerShipmentsValid === null && day.customerShipments > 0);
  if (!shipmentsKnown || day.customerShipmentsValid === false) {
    return { ...classified, observedUnits: null, excludedVineUnits: null, classification: 'unknown', eligible: false };
  }

  const positiveShipments = classified.observedUnits! > 0;
  const positiveStarting = positiveKnownBalance(
    day.startingBalance,
    day.startingBalanceValid,
  );
  const positiveEnding = positiveKnownBalance(
    day.endingBalance,
    day.endingBalanceValid,
  );

  // Vine-only shipments prove stock moved, not that shoppers had a selling day.
  // Keep this distinct from a known zero-stock day, which windows may skip.
  if (excludeVine && day.customerShipments > 0 && !positiveShipments &&
      !positiveStarting && !positiveEnding) {
    return { ...classified, adjustmentIssue: 'ambiguous-stock', classification: 'unknown', eligible: false };
  }

  if (positiveShipments || positiveStarting || positiveEnding) {
    const knownZeroEnding = zeroKnownBalance(
      day.endingBalance,
      day.endingBalanceValid,
    );
    const knownZeroStarting = zeroKnownBalance(
      day.startingBalance,
      day.startingBalanceValid,
    );

    if (knownZeroEnding && (positiveStarting || positiveShipments)) {
      return {
        ...classified,
        classification: 'eligible-possible-sellout',
        eligible: true,
      };
    }
    if (knownZeroStarting && positiveEnding) {
      return { ...classified, classification: 'eligible-restock', eligible: true };
    }
    if (!positiveStarting && !positiveEnding && positiveShipments) {
      return {
        ...classified,
        classification: 'eligible-shipment-evidence',
        eligible: true,
      };
    }
    return { ...classified, classification: 'eligible-stocked', eligible: true };
  }

  if (
    zeroKnownBalance(day.startingBalance, day.startingBalanceValid) &&
    zeroKnownBalance(day.endingBalance, day.endingBalanceValid) &&
    day.customerShipments === 0
  ) {
    return { ...classified, classification: 'out-of-stock', eligible: false };
  }

  return { ...classified, classification: 'unknown', eligible: false };
}

function buildPeriod(days: ClassifiedSalesDay[]): VelocityPeriod | null {
  if (days.length === 0) return null;
  const startDate = days[0].activityDate;
  const endDate = days.at(-1)!.activityDate;
  const unitsShipped = days.reduce(
    (sum, day) => sum + day.observedUnits!,
    0,
  );
  return {
    startDate,
    endDate,
    eligibleDays: days.length,
    calendarDays: dayDifference(startDate, endDate) + 1,
    unitsShipped,
    totalShipments: days.reduce((sum, day) => sum + day.customerShipments, 0),
    excludedVineUnits: days.reduce((sum, day) => sum + day.excludedVineUnits!, 0),
    dailyVelocity: unitsShipped / days.length,
    possibleSelloutDays: days.filter(
      (day) => day.classification === 'eligible-possible-sellout',
    ).length,
    restockDays: days.filter(
      (day) => day.classification === 'eligible-restock',
    ).length,
    shipmentEvidenceOnlyDays: days.filter(
      (day) => day.classification === 'eligible-shipment-evidence',
    ).length,
    excludedStockoutDays:
      dayDifference(startDate, endDate) + 1 - days.length,
  };
}

function validPeriod(
  eligibleDays: ClassifiedSalesDay[],
  expectedDays: number,
): VelocityPeriod | null {
  if (eligibleDays.length !== expectedDays) return null;
  const period = buildPeriod(eligibleDays);
  if (!period || period.calendarDays > expectedDays * 3) return null;
  return period;
}

/** Split at unknown evidence or a missing calendar date. Known OOS days stay in a segment. */
function knownSegments(days: ClassifiedSalesDay[]): ClassifiedSalesDay[][] {
  const segments: ClassifiedSalesDay[][] = [];
  let current: ClassifiedSalesDay[] = [];
  let previousDate: string | null = null;

  const flush = () => {
    if (current.length > 0) segments.push(current);
    current = [];
  };

  for (const day of days) {
    const missingCalendarDay =
      previousDate !== null && dayDifference(previousDate, day.activityDate) > 1;
    if (missingCalendarDay || day.classification === 'unknown') flush();
    if (day.classification !== 'unknown') current.push(day);
    previousDate = day.activityDate;
  }
  flush();
  return segments;
}

function growthMeetsThreshold(
  earlier: VelocityPeriod,
  later: VelocityPeriod,
): boolean {
  if (earlier.dailyVelocity <= 0) return later.dailyVelocity > 0;
  const absolute = later.dailyVelocity - earlier.dailyVelocity;
  const percentage = absolute / earlier.dailyVelocity;
  return absolute >= 0.1 && percentage >= 0.15;
}

function classifyTrend(input: {
  recent: VelocityPeriod | null;
  previous: VelocityPeriod | null;
  older: VelocityPeriod | null;
  early: VelocityPeriod | null;
  analysisDate: string | null;
}): TrendKind {
  const { recent, previous, older, early, analysisDate } = input;
  const latestObserved = recent ?? early;
  if (
    latestObserved &&
    analysisDate &&
    dayDifference(latestObserved.endDate, analysisDate) > 14
  ) {
    return 'historical-only';
  }
  if (!recent) return early ? 'early-launch' : 'insufficient-data';
  if (!previous) return 'insufficient-data';
  if (previous.dailyVelocity === 0 && recent.dailyVelocity > 0) {
    return 'new-activity';
  }
  if (recent.unitsShipped === 0 && previous.unitsShipped === 0) {
    return 'no-observed-shipments';
  }
  if (recent.unitsShipped + previous.unitsShipped < 20) {
    return 'limited-volume';
  }
  if (
    older &&
    older.unitsShipped + previous.unitsShipped >= 20 &&
    growthMeetsThreshold(older, previous) &&
    growthMeetsThreshold(previous, recent)
  ) {
    return 'sustained-growth';
  }
  const absolute = recent.dailyVelocity - previous.dailyVelocity;
  const percentage =
    previous.dailyVelocity === 0 ? null : absolute / previous.dailyVelocity;
  if (absolute >= 0.1 && percentage !== null && percentage >= 0.15) {
    return 'trending-up';
  }
  if (absolute <= -0.1 && percentage !== null && percentage <= -0.15) {
    return 'trending-down';
  }
  return 'stable';
}

/**
 * Calculate all sales-momentum evidence for one SKU. The function is pure so
 * the dedicated page and Reorder share one test surface and one definition.
 */
export function calculateSalesMomentum(
  rows: SalesLedgerDay[],
  options: SalesMomentumOptions,
): SalesMomentumResult {
  const sorted = [...rows].sort((a, b) =>
    a.activityDate.localeCompare(b.activityDate),
  );
  const dataThroughDate =
    options.analysisDate ?? sorted.at(-1)?.activityDate ?? null;
  if (!dataThroughDate) {
    return {
      days: [],
      recent: null,
      previous: null,
      older: null,
      early: null,
      best: null,
      absoluteChange: null,
      percentageChange: null,
      trend: 'insufficient-data',
      dataThroughDate: null,
    };
  }

  const historyStart = dateMinusDays(dataThroughDate, options.historyDays - 1);
  const days = sorted
    .filter(
      (row) =>
        row.activityDate >= historyStart && row.activityDate <= dataThroughDate,
    )
    .map((day) => classifySalesDay(day, options.excludeVine));
  const segments = knownSegments(days);
  const latestSegment = [...segments]
    .reverse()
    .find((segment) => segment.some((day) => day.eligible));
  const eligible = (latestSegment ?? []).filter((day) => day.eligible);
  const n = options.windowDays;

  const recentDays = eligible.slice(-n);
  const recent = validPeriod(recentDays, n);
  const previousDays = eligible.slice(-2 * n, -n);
  let previous = validPeriod(previousDays, n);
  if (
    recent &&
    previous &&
    (dayDifference(previous.endDate, recent.startDate) - 1 > 28 ||
      dayDifference(previous.startDate, recent.endDate) + 1 > 90)
  ) {
    previous = null;
  }
  const olderDays = eligible.slice(-3 * n, -2 * n);
  let older = validPeriod(olderDays, n);
  if (
    previous &&
    older &&
    (dayDifference(older.endDate, previous.startDate) - 1 > 28 ||
      (recent && dayDifference(older.startDate, recent.endDate) + 1 > 90))
  ) {
    older = null;
  }

  const earlyDays = recent
    ? []
    : eligible.slice(-Math.min(eligible.length, n - 1));
  const early =
    earlyDays.length >= 3 &&
    buildPeriod(earlyDays)!.calendarDays <= earlyDays.length * 3
      ? buildPeriod(earlyDays)
      : null;

  let best: VelocityPeriod | null = null;
  for (const segment of segments) {
    const candidateDays = segment.filter((day) => day.eligible);
    for (let index = 0; index + n <= candidateDays.length; index += 1) {
      const candidate = validPeriod(candidateDays.slice(index, index + n), n);
      if (!candidate) continue;
      if (
        !best ||
        candidate.dailyVelocity > best.dailyVelocity ||
        (candidate.dailyVelocity === best.dailyVelocity &&
          (candidate.calendarDays < best.calendarDays ||
            (candidate.calendarDays === best.calendarDays &&
              candidate.endDate > best.endDate)))
      ) {
        best = candidate;
      }
    }
  }

  const absoluteChange =
    recent && previous
      ? recent.dailyVelocity - previous.dailyVelocity
      : null;
  const percentageChange =
    absoluteChange !== null && previous && previous.dailyVelocity > 0
      ? (absoluteChange / previous.dailyVelocity) * 100
      : null;

  return {
    days,
    recent,
    previous,
    older,
    early,
    best,
    absoluteChange,
    percentageChange,
    trend: classifyTrend({
      recent,
      previous,
      older,
      early,
      analysisDate: dataThroughDate,
    }),
    dataThroughDate,
  };
}
