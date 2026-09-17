import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_MARKETPLACE, type Marketplace } from '@/lib/amazon/types';
import type {
  RecommendationRow,
  SourceHealthRow,
} from '@/lib/reorder/service';
import {
  calculateSalesMomentum,
  type AnalyticsHistoryDays,
  type AnalyticsWindowDays,
  type SalesLedgerDay,
  type SalesMomentumResult,
  type TrendKind,
} from './sales-momentum';

const HISTORY_PAGE_SIZE = 1_000;
const MS_PER_DAY = 86_400_000;
const LEDGER_MAX_AGE_MS = 48 * 60 * 60 * 1_000;

type DbError = { message: string } | null;

export type LedgerDbRow = {
  marketplace_id: string;
  sku: string;
  activity_date: string;
  customer_shipments: number;
  customer_shipments_valid: boolean | null;
  sellable_starting_balance: number | null;
  starting_balance_valid: boolean | null;
  sellable_ending_balance: number | null;
  ending_balance_valid: boolean | null;
};

type LedgerPage = {
  data: unknown[] | null;
  error: DbError;
};

/** Local read shape so the analytics module does not export Supabase generics. */
type LedgerHistoryDb = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        gte(column: string, value: string): {
          lte(column: string, value: string): {
            order(
              column: string,
              options: { ascending: boolean },
            ): {
              order(
                column: string,
                options: { ascending: boolean },
              ): {
                range(from: number, to: number): PromiseLike<LedgerPage>;
              };
            };
          };
        };
      };
    };
  };
};

export interface ReadAnalyticsHistoryDeps {
  supabase: Pick<SupabaseClient, 'from'>;
  marketplace?: Marketplace;
  historyDays: AnalyticsHistoryDays;
  now?: Date;
}

export interface AnalyticsHistoryResult {
  rows: LedgerDbRow[];
  dataThroughDate: string | null;
  error?: string;
}

export interface InventoryCoverScenarios {
  configured: number | null;
  recent: number | null;
  best: number | null;
}

export interface SalesAnalyticsProduct {
  marketplaceId: string;
  sku: string;
  title: string;
  isLegacy: boolean;
  usableSupply: number | null;
  fba: number | null;
  fbaInbound: number | null;
  awd: number | null;
  svd: number | null;
  configuredVelocity: number | null;
  momentum: SalesMomentumResult;
  coverDays: InventoryCoverScenarios;
  currentEvidenceAvailable: boolean;
  stockConstrained: boolean;
}

export interface MomentumSignal {
  kind: TrendKind;
  label: string;
  absoluteChange: number | null;
  percentageChange: number | null;
  recentVelocity: number | null;
  previousVelocity: number | null;
  recentStartDate: string | null;
  recentEndDate: string | null;
  previousStartDate: string | null;
  previousEndDate: string | null;
}

export interface BuildSalesAnalyticsInput {
  products: RecommendationRow[];
  ledgerRows: LedgerDbRow[];
  windowDays: AnalyticsWindowDays;
  historyDays: AnalyticsHistoryDays;
  dataThroughDate: string | null;
  /** False preserves dated evidence but prevents it from claiming a current trend. */
  currentEvidenceAvailable?: boolean;
}

/** Block current momentum labels when the daily ledger mirror is unhealthy. */
export function analyticsSourceIssue(
  sources: SourceHealthRow[],
  now: Date = new Date(),
): string | null {
  const ledger = sources.find((source) => source.source === 'fba_ledger');
  if (!ledger) return 'FBA ledger sync state is missing';
  if (ledger.status !== 'success') {
    return `FBA ledger sync is ${ledger.status}`;
  }
  if (!ledger.lastSuccessAt) return 'FBA ledger has never completed successfully';
  const lastSuccess = Date.parse(ledger.lastSuccessAt);
  if (!Number.isFinite(lastSuccess)) return 'FBA ledger freshness is unknown';
  if (now.getTime() - lastSuccess > LEDGER_MAX_AGE_MS) {
    return 'FBA ledger is more than 48 hours old';
  }
  return null;
}

function dateMinusDays(date: Date, days: number): string {
  return new Date(date.getTime() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

function ledgerDay(row: LedgerDbRow): SalesLedgerDay {
  return {
    activityDate: row.activity_date,
    customerShipments: row.customer_shipments,
    customerShipmentsValid: row.customer_shipments_valid,
    startingBalance: row.sellable_starting_balance,
    startingBalanceValid: row.starting_balance_valid,
    endingBalance: row.sellable_ending_balance,
    endingBalanceValid: row.ending_balance_valid,
  };
}

function coverDays(supply: number | null, velocity: number | null): number | null {
  if (supply === null || velocity === null || velocity <= 0) return null;
  return Math.floor(supply / velocity);
}

export function trendLabel(momentum: SalesMomentumResult): string {
  const percent =
    momentum.percentageChange === null
      ? ''
      : ` ${momentum.percentageChange >= 0 ? '+' : ''}${Math.round(momentum.percentageChange)}%`;
  switch (momentum.trend) {
    case 'sustained-growth':
      return `Sustained growth${percent}`;
    case 'trending-up':
      return `Trending up${percent}`;
    case 'trending-down':
      return `Trending down${percent}`;
    case 'stable':
      return 'Stable';
    case 'new-activity':
      return 'New activity';
    case 'no-observed-shipments':
      return 'No observed shipments';
    case 'limited-volume':
      return `Limited volume${percent}`;
    case 'early-launch':
      return `Early ${momentum.early?.eligibleDays ?? 0}d`;
    case 'historical-only':
      return 'Historical only';
    case 'insufficient-data':
      return 'Needs evidence';
  }
}

export function momentumSignal(momentum: SalesMomentumResult): MomentumSignal {
  return {
    kind: momentum.trend,
    label: trendLabel(momentum),
    absoluteChange: momentum.absoluteChange,
    percentageChange: momentum.percentageChange,
    recentVelocity: momentum.recent?.dailyVelocity ?? momentum.early?.dailyVelocity ?? null,
    previousVelocity: momentum.previous?.dailyVelocity ?? null,
    recentStartDate: momentum.recent?.startDate ?? momentum.early?.startDate ?? null,
    recentEndDate: momentum.recent?.endDate ?? momentum.early?.endDate ?? null,
    previousStartDate: momentum.previous?.startDate ?? null,
    previousEndDate: momentum.previous?.endDate ?? null,
  };
}

/**
 * Read a store-wide ledger history without relying on PostgREST's default row
 * limit. Ordering by the natural-key columns makes page boundaries stable.
 */
export async function readAnalyticsHistory(
  deps: ReadAnalyticsHistoryDeps,
): Promise<AnalyticsHistoryResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;
  const now = deps.now ?? new Date();
  // Ledger days are daily aggregates. Exclude the current UTC date so a
  // partial day cannot depress velocity or manufacture a trend change.
  const completedThrough = new Date(now.getTime() - MS_PER_DAY);
  const startDate = dateMinusDays(completedThrough, deps.historyDays - 1);
  const endDate = completedThrough.toISOString().slice(0, 10);
  const db = deps.supabase as unknown as LedgerHistoryDb;
  const rows: LedgerDbRow[] = [];

  for (let offset = 0; ; offset += HISTORY_PAGE_SIZE) {
    const page = await db
      .from('fba_daily_velocity_inputs')
      .select(
        'marketplace_id, sku, activity_date, customer_shipments, customer_shipments_valid, sellable_starting_balance, starting_balance_valid, sellable_ending_balance, ending_balance_valid',
      )
      .eq('marketplace_id', marketplace.id)
      .gte('activity_date', startDate)
      .lte('activity_date', endDate)
      .order('activity_date', { ascending: true })
      .order('sku', { ascending: true })
      .range(offset, offset + HISTORY_PAGE_SIZE - 1);

    if (page.error) {
      return { rows: [], dataThroughDate: null, error: page.error.message };
    }
    const pageRows = (page.data ?? []) as LedgerDbRow[];
    rows.push(...pageRows);
    if (pageRows.length < HISTORY_PAGE_SIZE) break;
  }

  return {
    rows,
    dataThroughDate:
      rows.map((row) => row.activity_date).sort().at(-1) ?? null,
  };
}

/** Build product-level analytics from canonical reorder supply and ledger facts. */
export function buildSalesAnalytics(
  input: BuildSalesAnalyticsInput,
): SalesAnalyticsProduct[] {
  const ledgerBySku = new Map<string, LedgerDbRow[]>();
  for (const row of input.ledgerRows) {
    const rows = ledgerBySku.get(row.sku) ?? [];
    rows.push(row);
    ledgerBySku.set(row.sku, rows);
  }

  return input.products.map((product) => {
    const calculatedMomentum = calculateSalesMomentum(
      (ledgerBySku.get(product.sku) ?? []).map(ledgerDay),
      {
        windowDays: input.windowDays,
        historyDays: input.historyDays,
        ...(input.dataThroughDate
          ? { analysisDate: input.dataThroughDate }
          : {}),
      },
    );
    const hasObservedHistory =
      calculatedMomentum.recent !== null ||
      calculatedMomentum.early !== null ||
      calculatedMomentum.best !== null;
    const momentum =
      input.currentEvidenceAvailable === false && hasObservedHistory
        ? { ...calculatedMomentum, trend: 'historical-only' as const }
        : calculatedMomentum;
    const observedVelocity =
      momentum.recent?.dailyVelocity ?? momentum.early?.dailyVelocity ?? null;
    const scenarios = {
      configured: coverDays(product.usableSupply, product.dailyDemand),
      recent: coverDays(product.usableSupply, observedVelocity),
      best: coverDays(product.usableSupply, momentum.best?.dailyVelocity ?? null),
    };

    return {
      marketplaceId: product.marketplaceId,
      sku: product.sku,
      title: product.title,
      isLegacy: product.isLegacy,
      usableSupply: product.usableSupply,
      fba: product.sources.fba,
      fbaInbound: product.sources.fbaInbound,
      awd: product.sources.awd,
      svd: product.sources.svd,
      configuredVelocity: product.dailyDemand,
      momentum,
      coverDays: scenarios,
      currentEvidenceAvailable: input.currentEvidenceAvailable !== false,
      stockConstrained:
        input.currentEvidenceAvailable !== false &&
        scenarios.recent !== null &&
        scenarios.recent < 30,
    };
  });
}

export function momentumSignalsBySku(
  products: SalesAnalyticsProduct[],
): Record<string, MomentumSignal> {
  return Object.fromEntries(
    products.map((product) => [product.sku, momentumSignal(product.momentum)]),
  );
}
