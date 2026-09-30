import {
  classifySalesDay as classifyMomentumDay,
  type ClassifiedSalesDay as MomentumDay,
  type SalesLedgerDay,
} from './sales-momentum';

export type { SalesLedgerDay } from './sales-momentum';

export const ANALYTICS_WINDOW_OPTIONS = [7, 14, 28] as const;
export type AnalyticsWindowDays = (typeof ANALYTICS_WINDOW_OPTIONS)[number];

export const ANALYTICS_HISTORY_OPTIONS = [90, 180, 365] as const;
export type AnalyticsHistoryDays = (typeof ANALYTICS_HISTORY_OPTIONS)[number];

export const MIN_TREND_DAYS = 5;

export type SalesDayClassification =
  | 'eligible-stocked'
  | 'eligible-possible-sellout'
  | 'eligible-restock'
  | 'shipment-only-evidence'
  | 'out-of-stock'
  | 'unknown';

export interface ClassifiedSalesDay extends Omit<MomentumDay, 'classification' | 'eligible'> {
  classification: SalesDayClassification;
  /** True only when the daily balance confirms sellable inventory. */
  eligible: boolean;
}

export type InStockRunDirection =
  | 'growing'
  | 'declining'
  | 'stable'
  | 'insufficient';

export interface InStockRun {
  startDate: string;
  endDate: string;
  fullRunDays: number;
  eligibleDays: number;
  unitsShipped: number;
  averageVelocity: number;
  startVelocity: number;
  endVelocity: number;
  slopePerDay: number | null;
  growthPercent: number | null;
  direction: InStockRunDirection;
  endedInSellout: boolean;
}

export interface VelocityPeriod {
  startDate: string;
  endDate: string;
  eligibleDays: number;
  calendarDays: number;
  unitsShipped: number;
  dailyVelocity: number;
  possibleSelloutDays: number;
  restockDays: number;
  shipmentEvidenceOnlyDays: number;
  excludedStockoutDays: number;
}

export type InStockTrendKind =
  | 'growing'
  | 'declining'
  | 'stable'
  | 'quick-sellout'
  | 'no-observed-sales'
  | 'historical-only'
  | 'insufficient-data';

export type TrendConfidence = 'high' | 'medium' | 'low' | 'none';

export interface InStockTrendResult {
  days: ClassifiedSalesDay[];
  runs: InStockRun[];
  latestRun: InStockRun | null;
  best: VelocityPeriod | null;
  trend: InStockTrendKind;
  confidence: TrendConfidence;
  growingRuns: number;
  qualifyingRuns: number;
  stockoutConstrained: boolean;
  dataThroughDate: string | null;
}

export interface InStockTrendOptions {
  windowDays: AnalyticsWindowDays;
  historyDays: AnalyticsHistoryDays;
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

/** Reuse giveaway reconciliation, then require positive inventory evidence. */
export function classifySalesDay(day: SalesLedgerDay, excludeVine = false): ClassifiedSalesDay {
  const classified = classifyMomentumDay(day, excludeVine);
  const stockConfirmed =
    (day.startingBalanceValid === true && (day.startingBalance ?? 0) > 0) ||
    (day.endingBalanceValid === true && (day.endingBalance ?? 0) > 0);
  if (classified.classification === 'eligible-shipment-evidence' ||
      (classified.eligible && !stockConfirmed)) {
    return { ...classified, classification: 'shipment-only-evidence', eligible: false };
  }
  return {
    ...classified,
    classification: classified.classification as SalesDayClassification,
  };
}

function splitInStockRuns(days: ClassifiedSalesDay[]): ClassifiedSalesDay[][] {
  const runs: ClassifiedSalesDay[][] = [];
  let current: ClassifiedSalesDay[] = [];
  let previousDate: string | null = null;

  const flush = () => {
    if (current.length > 0) runs.push(current);
    current = [];
  };

  for (const day of days) {
    if (
      previousDate !== null &&
      dayDifference(previousDate, day.activityDate) !== 1
    ) {
      flush();
    }

    if (!day.eligible) {
      flush();
      previousDate = day.activityDate;
      continue;
    }

    if (day.classification === 'eligible-restock' && current.length > 0) {
      flush();
    }
    current.push(day);
    if (day.classification === 'eligible-possible-sellout') flush();
    previousDate = day.activityDate;
  }
  flush();
  return runs;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function theilSenSlope(days: ClassifiedSalesDay[]): number {
  const slopes: number[] = [];
  for (let left = 0; left < days.length - 1; left += 1) {
    for (let right = left + 1; right < days.length; right += 1) {
      slopes.push(
        (days[right].observedUnits! - days[left].observedUnits!) /
          (right - left),
      );
    }
  }
  return median(slopes);
}

function summarizeRun(
  fullRun: ClassifiedSalesDay[],
  windowDays: AnalyticsWindowDays,
): InStockRun {
  const analyzed = fullRun.slice(-windowDays);
  const eligibleDays = analyzed.length;
  const edgeDays = Math.min(3, Math.floor(eligibleDays / 2));
  const unitsShipped = analyzed.reduce(
    (sum, day) => sum + day.observedUnits!,
    0,
  );
  const startVelocity = mean(
    analyzed.slice(0, Math.max(edgeDays, 1)).map((day) => day.observedUnits!),
  );
  const endVelocity = mean(
    analyzed.slice(-Math.max(edgeDays, 1)).map((day) => day.observedUnits!),
  );
  const slopePerDay =
    eligibleDays >= MIN_TREND_DAYS ? theilSenSlope(analyzed) : null;
  const growthPercent =
    startVelocity > 0
      ? ((endVelocity - startVelocity) / startVelocity) * 100
      : null;

  let direction: InStockRunDirection = 'insufficient';
  if (slopePerDay !== null) {
    const growsEnough =
      slopePerDay >= 0.1 &&
      (startVelocity === 0
        ? endVelocity > 0
        : growthPercent !== null && growthPercent >= 15);
    const declinesEnough =
      slopePerDay <= -0.1 &&
      growthPercent !== null &&
      growthPercent <= -15;
    direction = growsEnough
      ? 'growing'
      : declinesEnough
        ? 'declining'
        : 'stable';
  }

  return {
    startDate: analyzed[0].activityDate,
    endDate: analyzed.at(-1)!.activityDate,
    fullRunDays: fullRun.length,
    eligibleDays,
    unitsShipped,
    averageVelocity: unitsShipped / eligibleDays,
    startVelocity,
    endVelocity,
    slopePerDay,
    growthPercent,
    direction,
    endedInSellout:
      fullRun.at(-1)?.classification === 'eligible-possible-sellout',
  };
}

function velocityPeriod(days: ClassifiedSalesDay[]): VelocityPeriod {
  const unitsShipped = days.reduce(
    (sum, day) => sum + day.observedUnits!,
    0,
  );
  return {
    startDate: days[0].activityDate,
    endDate: days.at(-1)!.activityDate,
    eligibleDays: days.length,
    calendarDays: days.length,
    unitsShipped,
    dailyVelocity: unitsShipped / days.length,
    possibleSelloutDays: days.filter(
      (day) => day.classification === 'eligible-possible-sellout',
    ).length,
    restockDays: days.filter(
      (day) => day.classification === 'eligible-restock',
    ).length,
    shipmentEvidenceOnlyDays: 0,
    excludedStockoutDays: 0,
  };
}

function bestSustainedVelocity(
  runs: ClassifiedSalesDay[][],
  windowDays: AnalyticsWindowDays,
): VelocityPeriod | null {
  let best: VelocityPeriod | null = null;
  for (const run of runs) {
    for (let index = 0; index + windowDays <= run.length; index += 1) {
      const candidate = velocityPeriod(run.slice(index, index + windowDays));
      if (
        !best ||
        candidate.dailyVelocity > best.dailyVelocity ||
        (candidate.dailyVelocity === best.dailyVelocity &&
          candidate.endDate > best.endDate)
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

function confidenceFor(
  trend: InStockTrendKind,
  runs: InStockRun[],
): TrendConfidence {
  if (trend === 'insufficient-data' || trend === 'historical-only') return 'none';
  const recentRuns = runs.slice(-4);
  if (trend === 'quick-sellout') {
    const sellouts = recentRuns.filter((run) => run.endedInSellout).length;
    return sellouts >= 3 ? 'high' : sellouts >= 2 ? 'medium' : 'low';
  }

  const qualifying = recentRuns.filter((run) => run.slopePerDay !== null);
  const latest = recentRuns.at(-1);
  const totalDays = qualifying.reduce((sum, run) => sum + run.eligibleDays, 0);
  const totalUnits = qualifying.reduce((sum, run) => sum + run.unitsShipped, 0);
  if (trend === 'no-observed-sales') {
    if (qualifying.length >= 2 && totalDays >= 14) return 'high';
    return totalDays >= 7 ? 'medium' : 'low';
  }
  const agreeing = qualifying.filter((run) => run.direction === trend).length;
  if (
    qualifying.length >= 2 &&
    totalDays >= 14 &&
    totalUnits >= 20 &&
    agreeing >= 2
  ) {
    return 'high';
  }
  if (
    (latest && latest.eligibleDays >= 7 && latest.unitsShipped >= 10) ||
    (totalDays >= 10 && totalUnits >= 10)
  ) {
    return 'medium';
  }
  return 'low';
}

export function calculateInStockTrend(
  rows: SalesLedgerDay[],
  options: InStockTrendOptions,
): InStockTrendResult {
  const sorted = [...rows].sort((left, right) =>
    left.activityDate.localeCompare(right.activityDate),
  );
  const dataThroughDate =
    options.analysisDate ?? sorted.at(-1)?.activityDate ?? null;
  if (!dataThroughDate) {
    return {
      days: [],
      runs: [],
      latestRun: null,
      best: null,
      trend: 'insufficient-data',
      confidence: 'none',
      growingRuns: 0,
      qualifyingRuns: 0,
      stockoutConstrained: false,
      dataThroughDate: null,
    };
  }

  const historyStart = dateMinusDays(dataThroughDate, options.historyDays - 1);
  const days = sorted
    .filter(
      (row) =>
        row.activityDate >= historyStart && row.activityDate <= dataThroughDate,
    )
    .map((day) => classifySalesDay(day, options.excludeVine === true));
  const rawRuns = splitInStockRuns(days);
  const runs = rawRuns.map((run) => summarizeRun(run, options.windowDays));
  const latestRun = runs.at(-1) ?? null;
  const qualifying = runs.slice(-4).filter((run) => run.slopePerDay !== null);
  const recentRuns = runs.slice(-3);
  const stockoutConstrained =
    latestRun?.endedInSellout === true ||
    recentRuns.filter((run) => run.endedInSellout).length >= 2;

  let trend: InStockTrendKind = 'insufficient-data';
  if (latestRun) {
    if (dayDifference(latestRun.endDate, dataThroughDate) > 14) {
      trend = 'historical-only';
    } else if (
      latestRun.eligibleDays < MIN_TREND_DAYS &&
      latestRun.endedInSellout
    ) {
      trend = 'quick-sellout';
    } else if (latestRun.slopePerDay !== null) {
      trend =
        latestRun.unitsShipped === 0
          ? 'no-observed-sales'
          : latestRun.direction === 'insufficient'
            ? 'insufficient-data'
            : latestRun.direction;
    }
  }

  return {
    days,
    runs,
    latestRun,
    best: bestSustainedVelocity(rawRuns, options.windowDays),
    trend,
    confidence: confidenceFor(trend, runs),
    growingRuns: qualifying.filter((run) => run.direction === 'growing').length,
    qualifyingRuns: qualifying.length,
    stockoutConstrained,
    dataThroughDate,
  };
}
