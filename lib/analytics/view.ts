import {
  ANALYTICS_HISTORY_OPTIONS,
  ANALYTICS_WINDOW_OPTIONS,
  type AnalyticsHistoryDays,
  type AnalyticsWindowDays,
} from './in-stock-trend';
import type { SalesAnalyticsProduct } from './service';

export type AnalyticsSearchParams = Record<
  string,
  string | string[] | undefined
>;
export type AnalyticsFilter =
  | 'all'
  | 'growing'
  | 'constrained'
  | 'declining'
  | 'insufficient'
  | 'historical';
export type AnalyticsSort = 'slope' | 'latest' | 'best' | 'cover' | 'sku';

export interface AnalyticsViewQuery {
  windowDays: AnalyticsWindowDays;
  historyDays: AnalyticsHistoryDays;
  filter: AnalyticsFilter;
  sort: AnalyticsSort;
  query: string;
  selectedSku: string | null;
}

export interface AnalyticsViewModel {
  visible: SalesAnalyticsProduct[];
  selected: SalesAnalyticsProduct | null;
  summary: {
    growing: number;
    constrained: number;
    declining: number;
    insufficient: number;
  };
}

const FILTERS = [
  'all',
  'growing',
  'constrained',
  'declining',
  'insufficient',
  'historical',
] as const;
const SORTS = ['slope', 'latest', 'best', 'cover', 'sku'] as const;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function numericOption<T extends readonly number[]>(
  value: string | undefined,
  options: T,
  fallback: T[number],
): T[number] {
  const parsed = Number(value);
  return options.includes(parsed as T[number]) ? (parsed as T[number]) : fallback;
}

function textOption<T extends readonly string[]>(
  value: string | undefined,
  options: T,
  fallback: T[number],
): T[number] {
  return options.includes(value as T[number]) ? (value as T[number]) : fallback;
}

export function parseAnalyticsViewQuery(
  params: AnalyticsSearchParams,
): AnalyticsViewQuery {
  return {
    windowDays: numericOption(one(params.window), ANALYTICS_WINDOW_OPTIONS, 7),
    historyDays: numericOption(one(params.history), ANALYTICS_HISTORY_OPTIONS, 365),
    filter: textOption(one(params.filter), FILTERS, 'all'),
    sort: textOption(one(params.sort), SORTS, 'slope'),
    query: (one(params.q) ?? '').trim(),
    selectedSku: one(params.sku) ?? null,
  };
}

function matchesFilter(
  product: SalesAnalyticsProduct,
  filter: AnalyticsFilter,
): boolean {
  switch (filter) {
    case 'all':
      return !product.isLegacy;
    case 'growing':
      return !product.isLegacy && product.trend.trend === 'growing';
    case 'constrained':
      return product.stockConstrained && !product.isLegacy;
    case 'declining':
      return !product.isLegacy && product.trend.trend === 'declining';
    case 'insufficient':
      return (
        !product.isLegacy &&
        (product.trend.trend === 'insufficient-data' ||
          product.trend.trend === 'no-observed-sales')
      );
    case 'historical':
      return product.isLegacy || product.trend.trend === 'historical-only';
  }
}

function sortProducts(
  products: SalesAnalyticsProduct[],
  sort: AnalyticsSort,
): SalesAnalyticsProduct[] {
  return [...products].sort((left, right) => {
    if (sort === 'sku') return left.sku.localeCompare(right.sku);
    const metric = (product: SalesAnalyticsProduct): number | null => {
      switch (sort) {
        case 'slope':
          return product.trend.latestRun?.slopePerDay ?? null;
        case 'latest':
          return product.trend.latestRun?.averageVelocity ?? null;
        case 'best':
          return product.trend.best?.dailyVelocity ?? null;
        case 'cover':
          return product.coverDays.recent;
      }
    };
    const a = metric(left);
    const b = metric(right);
    if (a === null && b === null) return left.sku.localeCompare(right.sku);
    if (a === null) return 1;
    if (b === null) return -1;
    return sort === 'cover' ? a - b : b - a;
  });
}

export function buildAnalyticsViewModel(
  products: SalesAnalyticsProduct[],
  query: AnalyticsViewQuery,
): AnalyticsViewModel {
  const normalizedQuery = query.query.toLowerCase();
  const visible = sortProducts(
    products.filter(
      (product) =>
        matchesFilter(product, query.filter) &&
        (!normalizedQuery ||
          product.sku.toLowerCase().includes(normalizedQuery) ||
          product.title.toLowerCase().includes(normalizedQuery)),
    ),
    query.sort,
  );
  const active = products.filter((product) => !product.isLegacy);

  return {
    visible,
    selected: query.selectedSku
      ? products.find((product) => product.sku === query.selectedSku) ?? null
      : null,
    summary: {
      growing: active.filter((product) => product.trend.trend === 'growing').length,
      constrained: active.filter((product) => product.stockConstrained).length,
      declining: active.filter((product) => product.trend.trend === 'declining')
        .length,
      insufficient: active.filter(
        (product) =>
          product.trend.trend === 'insufficient-data' ||
          product.trend.trend === 'no-observed-sales',
      ).length,
    },
  };
}
