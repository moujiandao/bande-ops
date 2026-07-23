import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_MARKETPLACE, type Marketplace } from '@/lib/amazon/types';
import {
  mapPolicyRow,
  type ReplenishmentPolicy,
  type ReplenishmentPolicyRow,
} from '@/lib/settings/policy';
import {
  effectiveSetting,
  type PartialReplenishment,
  type ReplenishmentValues,
} from '@/lib/settings/resolve';
import { recommend, type Recommendation } from './recommend';
import { resolveSourceMapping } from './mappings';
import { calculateUsableSupply, toUnits, type UsableSupplyResult } from './supply';
import { classifyLegacy } from './legacy';

type ReorderReader = Pick<SupabaseClient, 'from'>;

export interface AssembleRecommendationsDeps {
  supabase: ReorderReader;
  marketplace?: Marketplace;
}

export interface SourceHealthRow {
  source: string;
  status: string;
  lastSuccessAt: string | null;
  rowCount: number | null;
  errorSummary: string | null;
}

export interface RecommendationRow {
  marketplaceId: string;
  sku: string;
  title: string;
  usableSupply: number | null;
  dailyDemand: number | null;
  velocitySampleDays: number | null;
  sourceMapping:
    | {
        status: 'mapped';
        svdItemId: string;
        mappingSource: 'fn_sku' | 'sku' | 'svd_item_id' | 'manual';
      }
    | { status: 'needs-review'; reason: 'missing-svd-mapping' };
  /** Long-dead SKU: excluded from the reorder and review lists. */
  isLegacy: boolean;
  /**
   * Per-source quantities, populated even when the recommendation fails.
   * usableSupply/supplyBreakdown are null whenever anything blocks the math,
   * but what we DO know about each source is still worth showing.
   */
  sources: {
    fba: number | null;
    awd: number | null;
    /** UNITS, converted from SVD's boxes. Null when the units are unknowable. */
    svd: number | null;
  };
  /** SVD's own denomination, kept for display. Null when unreadable. */
  svdBoxes: number | null;
  /** Units per SVD box for this SKU. Null when not configured. */
  svdUnitsPerBox: number | null;
  fnSku: string | null;
  supplyBreakdown:
    | (Extract<UsableSupplyResult, { status: 'ok' }>['breakdown'])
    | null;
  recommendation: Recommendation;
}

export interface AssembleRecommendationsResult {
  rows: RecommendationRow[];
  sourceHealth: SourceHealthRow[];
  policy: ReplenishmentPolicy;
  errors: {
    catalog?: string;
    fbaInventory?: string;
    awdInventory?: string;
    svdInventory?: string;
    mappings?: string;
    velocity?: string;
    settings?: string;
    policy?: string;
    sourceState?: string;
  };
}

const FALLBACK_DEFAULTS: ReplenishmentValues = {
  leadTimeDays: 14,
  safetyStock: 0,
  // 3 months of coverage when no policy/default row exists yet.
  coverageDays: 90,
};

type CatalogRow = {
  marketplace_id: string;
  sku: string;
  title: string;
  open_date: string | null;
};
type FbaRow = {
  marketplace_id: string;
  sku: string;
  fn_sku: string | null;
  fulfillable_quantity: number | null;
  inbound_working_quantity: number | null;
  inbound_shipped_quantity: number | null;
  inbound_receiving_quantity: number | null;
};
type AwdRow = {
  marketplace_id: string;
  sku: string;
  fn_sku: string | null;
  replenishment_quantity: number | null;
  available_distributable_quantity: number | null;
};
type SvdRow = {
  svd_item_id: string;
  sku: string | null;
  fn_sku: string | null;
  quantity: number | null;
};
type MappingRow = {
  marketplace_id: string;
  amazon_sku: string;
  svd_item_id: string | null;
  status: string;
};
type VelocityRow = {
  marketplace_id: string;
  sku: string;
  daily_velocity: number | string | null;
  status: string;
  in_stock_sample_days: number;
  last_sold_date: string | null;
};
type SettingRow = {
  marketplace_id: string;
  sku: string | null;
  // Nullable on per-SKU rows (migration 0016): null means "inherit the default".
  // Guaranteed non-null on the global default row by a check constraint.
  lead_time_days: number | null;
  safety_stock: number | null;
  /** Nullable: a row may predate the coverage column or leave it unset (falls back to default). */
  target_coverage_days: number | null;
  /**
   * Sellable units per SVD box. Per-SKU ONLY — unlike the fields above it has
   * no global-default fallback, so a value on the `sku IS NULL` row is ignored.
   */
  svd_units_per_box: number | null;
};
type SourceStateDbRow = {
  source: string;
  status: string;
  last_success_at: string | null;
  row_count: number | null;
  error_summary: string | null;
};

function rowKey(r: { marketplace_id: string; sku: string }): string {
  return `${r.marketplace_id}:${r.sku}`;
}

function toErrorMessage(error: unknown): string | undefined {
  return (error as { message?: string } | null)?.message;
}

function velocityValue(row: VelocityRow | undefined): number | null {
  if (!row || row.status !== 'ok' || row.daily_velocity === null) return null;
  const value = Number(row.daily_velocity);
  return Number.isFinite(value) ? value : null;
}

function mapSourceHealth(rows: SourceStateDbRow[]): SourceHealthRow[] {
  return rows.map((row) => ({
    source: row.source,
    status: row.status,
    lastSuccessAt: row.last_success_at,
    rowCount: row.row_count,
    errorSummary: row.error_summary,
  }));
}

const REQUIRED_SYNC_SOURCES = [
  'fba_inventory',
  'awd_inventory',
  'fba_ledger',
  'svd_inventory',
] as const;

function sourceState(source: string, status: string): SourceStateDbRow {
  return {
    source,
    status,
    last_success_at: null,
    row_count: null,
    error_summary: null,
  };
}

function blockingSource(
  rows: SourceStateDbRow[],
  sourceStateError: unknown,
): SourceStateDbRow | null {
  if (sourceStateError) return sourceState('source_sync_state', 'failed');

  const bySource = new Map(rows.map((row) => [row.source, row]));
  for (const source of REQUIRED_SYNC_SOURCES) {
    const row = bySource.get(source);
    if (!row) return sourceState(source, 'missing');
    if (row.status !== 'success') return row;
  }
  return null;
}

export async function assembleRecommendations(
  deps: AssembleRecommendationsDeps,
): Promise<AssembleRecommendationsResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;

  const [
    catalogRes,
    fbaRes,
    awdRes,
    svdRes,
    mappingsRes,
    velocityRes,
    settingsRes,
    policyRes,
    sourceStateRes,
  ] = await Promise.all([
    deps.supabase
      .from('catalog_items')
      .select('marketplace_id, sku, title, open_date')
      .eq('marketplace_id', marketplace.id),
    deps.supabase
      .from('inventory_levels')
      .select(
        'marketplace_id, sku, fn_sku, fulfillable_quantity, inbound_working_quantity, inbound_shipped_quantity, inbound_receiving_quantity',
      )
      .eq('marketplace_id', marketplace.id),
    deps.supabase
      .from('awd_inventory_levels')
      .select(
        'marketplace_id, sku, fn_sku, replenishment_quantity, available_distributable_quantity',
      )
      .eq('marketplace_id', marketplace.id),
    deps.supabase
      .from('svd_inventory_levels')
      .select('svd_item_id, sku, fn_sku, quantity'),
    deps.supabase
      .from('inventory_source_mappings')
      .select('marketplace_id, amazon_sku, svd_item_id, status')
      .eq('marketplace_id', marketplace.id),
    deps.supabase
      .from('sales_velocity')
      .select(
        'marketplace_id, sku, daily_velocity, status, in_stock_sample_days, last_sold_date',
      )
      .eq('marketplace_id', marketplace.id),
    deps.supabase
      .from('replenishment_settings')
      .select(
        'marketplace_id, sku, lead_time_days, safety_stock, target_coverage_days, svd_units_per_box',
      )
      .eq('marketplace_id', marketplace.id),
    deps.supabase.from('replenishment_policy').select('*').eq('marketplace_id', marketplace.id),
    deps.supabase
      .from('source_sync_state')
      .select('source, status, last_success_at, row_count, error_summary')
      .eq('marketplace_id', marketplace.id),
  ]);

  const catalogRows = (catalogRes.data ?? []) as CatalogRow[];
  const fbaRows = (fbaRes.data ?? []) as FbaRow[];
  const awdRows = (awdRes.data ?? []) as AwdRow[];
  const svdRows = (svdRes.data ?? []) as SvdRow[];
  const mappingRows = (mappingsRes.data ?? []) as MappingRow[];
  const velocityRows = (velocityRes.data ?? []) as VelocityRow[];
  const settingRows = (settingsRes.data ?? []) as SettingRow[];
  const policyRows = (policyRes.data ?? []) as ReplenishmentPolicyRow[];
  const sourceStateRows = (sourceStateRes.data ?? []) as SourceStateDbRow[];

  const policy = mapPolicyRow(policyRows[0] ?? null);
  const staleSource =
    policy.staleSourceMode === 'needs_review'
      ? blockingSource(sourceStateRows, sourceStateRes.error)
      : null;

  const fbaByKey = new Map<string, FbaRow>(fbaRows.map((row) => [rowKey(row), row]));
  const awdByKey = new Map<string, AwdRow>(awdRows.map((row) => [rowKey(row), row]));
  const velocityByKey = new Map<string, VelocityRow>(
    velocityRows.map((row) => [rowKey(row), row]),
  );
  const svdById = new Map<string, SvdRow>(svdRows.map((row) => [row.svd_item_id, row]));

  const defaultRow = settingRows.find((row) => row.sku === null) ?? null;
  const defaults: ReplenishmentValues = defaultRow
    ? {
        // A check constraint guarantees these are non-null on the default row,
        // but coalesce defensively so a broken/missing default falls back to the
        // app default rather than propagating null — same treatment as coverage.
        leadTimeDays: defaultRow.lead_time_days ?? FALLBACK_DEFAULTS.leadTimeDays,
        safetyStock: defaultRow.safety_stock ?? FALLBACK_DEFAULTS.safetyStock,
        coverageDays: defaultRow.target_coverage_days ?? FALLBACK_DEFAULTS.coverageDays,
      }
    : FALLBACK_DEFAULTS;
  // A per-SKU row overrides each field ONLY when that field is set; a null field
  // means "use the global default", so it is omitted here and effectiveSetting
  // fills it from `defaults`. This is what lets a row carry just an
  // svd_units_per_box without pinning lead time and safety stock (migration 0016).
  const overrideBySku = new Map<string, PartialReplenishment>(
    settingRows
      .filter((row): row is SettingRow & { sku: string } => row.sku !== null)
      .map((row) => [
        row.sku,
        {
          ...(row.lead_time_days !== null ? { leadTimeDays: row.lead_time_days } : {}),
          ...(row.safety_stock !== null ? { safetyStock: row.safety_stock } : {}),
          ...(row.target_coverage_days !== null
            ? { coverageDays: row.target_coverage_days }
            : {}),
        },
      ]),
  );

  // Pack size is resolved separately from effectiveSetting on purpose. Lead
  // time, safety stock, and coverage are policy choices where one global number
  // sensibly applies to everything; a pack size is a physical per-product fact,
  // so there is no default to fall back to and a missing value must stay
  // UNKNOWN rather than be approximated.
  const svdUnitsPerBoxBySku = new Map<string, number>(
    settingRows
      .filter(
        (row): row is SettingRow & { sku: string; svd_units_per_box: number } =>
          row.sku !== null && row.svd_units_per_box !== null,
      )
      .map((row) => [row.sku, row.svd_units_per_box]),
  );

  const activeManualMappings = mappingRows
    .filter((row) => row.status === 'active' && row.svd_item_id)
    .map((row) => ({ amazonSku: row.amazon_sku, svdItemId: row.svd_item_id as string }));

  const rows: RecommendationRow[] = catalogRows.map((item) => {
    const key = rowKey(item);
    const fba = fbaByKey.get(key) ?? null;
    const awd = awdByKey.get(key) ?? null;
    const fnSku = fba?.fn_sku ?? awd?.fn_sku ?? null;
    // A SKU with no velocity row never sold inside the ledger window, which the
    // classifier reads the same as a null last-sold date.
    const isLegacy = classifyLegacy({
      openDate: item.open_date,
      lastSoldDate: velocityByKey.get(key)?.last_sold_date ?? null,
    });
    const sources = {
      fba: fba?.fulfillable_quantity ?? null,
      // Absence means "not stored at AWD", which is 0 — matching the supply
      // math. Only a row with unreadable quantities is UNKNOWN.
      awd:
        awd === null
          ? 0
          : awd.available_distributable_quantity === null &&
              awd.replenishment_quantity === null
            ? null
            : (awd.available_distributable_quantity ?? 0) +
              (awd.replenishment_quantity ?? 0),
      svd: null as number | null,
    };
    const sourceMapping = resolveSourceMapping({
      amazonSku: item.sku,
      fnSku,
      svdRows: svdRows.map((row) => ({
        svdItemId: row.svd_item_id,
        sku: row.sku,
        fnSku: row.fn_sku,
      })),
      manualMappings: activeManualMappings,
    });

    const setting = effectiveSetting(overrideBySku.get(item.sku), defaults);
    const velocity = velocityByKey.get(key);
    const dailyDemand = velocityValue(velocity);

    // Resolved before the early returns so the box count stays visible on rows
    // that never reach the supply math — knowing "7 boxes, pack size unset"
    // is more useful than a blank cell.
    const svdUnitsPerBox = svdUnitsPerBoxBySku.get(item.sku) ?? null;
    const svd =
      sourceMapping.status === 'mapped'
        ? (svdById.get(sourceMapping.svdItemId) ?? null)
        : null;
    // Mapped but not carried at SVD is 0 boxes; carried with an unreadable
    // quantity stays UNKNOWN. An unmapped SKU has no box count at all.
    const svdBoxes =
      sourceMapping.status === 'mapped' ? (svd === null ? 0 : svd.quantity) : null;
    // Zero boxes is zero units under any pack size, so it never needs a factor.
    sources.svd =
      svdBoxes === null || svdBoxes === 0
        ? svdBoxes
        : svdUnitsPerBox === null
          ? null
          : toUnits(svdBoxes, svdUnitsPerBox);

    if (staleSource) {
      return {
        marketplaceId: item.marketplace_id,
        sku: item.sku,
        title: item.title,
        usableSupply: null,
        dailyDemand,
        velocitySampleDays: velocity?.in_stock_sample_days ?? null,
        sourceMapping,
        isLegacy,
        fnSku,
        sources,
        svdBoxes,
        svdUnitsPerBox,
        supplyBreakdown: null,
        recommendation: {
          status: 'needs-review',
          reason: `stale-source-${staleSource.source}`,
        },
      };
    }

    if (sourceMapping.status === 'needs-review') {
      return {
        marketplaceId: item.marketplace_id,
        sku: item.sku,
        title: item.title,
        usableSupply: null,
        dailyDemand,
        velocitySampleDays: velocity?.in_stock_sample_days ?? null,
        sourceMapping,
        isLegacy,
        fnSku,
        sources,
        svdBoxes,
        svdUnitsPerBox,
        supplyBreakdown: null,
        recommendation: { status: 'needs-review', reason: sourceMapping.reason },
      };
    }

    const supply = calculateUsableSupply({
      fba: fba
        ? {
            fulfillableQuantity: fba.fulfillable_quantity,
            inboundWorkingQuantity: fba.inbound_working_quantity,
            inboundShippedQuantity: fba.inbound_shipped_quantity,
            inboundReceivingQuantity: fba.inbound_receiving_quantity,
          }
        : null,
      awd: awd
        ? {
            availableQuantity: awd.available_distributable_quantity,
            replenishmentQuantity: awd.replenishment_quantity,
          }
        : null,
      svd: svd ? { quantity: svd.quantity } : null,
      svdUnitsPerBox,
      policy,
    });

    const usableSupply = supply.status === 'ok' ? supply.usableSupply : null;
    const recommendation =
      supply.status === 'needs-review'
        ? { status: 'needs-review' as const, reason: supply.reason }
        : recommend({
            usableSupply,
            dailyDemand,
            leadTimeDays: setting.leadTimeDays,
            safetyStock: setting.safetyStock,
            coverageDays: setting.coverageDays,
          });

    return {
      marketplaceId: item.marketplace_id,
      sku: item.sku,
      title: item.title,
      usableSupply,
      dailyDemand,
      velocitySampleDays: velocity?.in_stock_sample_days ?? null,
      sourceMapping,
      isLegacy,
      fnSku,
      sources,
      svdBoxes,
      svdUnitsPerBox,
      supplyBreakdown: supply.status === 'ok' ? supply.breakdown : null,
      recommendation,
    };
  });

  return {
    rows,
    sourceHealth: mapSourceHealth(sourceStateRows),
    policy,
    errors: {
      catalog: toErrorMessage(catalogRes.error),
      fbaInventory: toErrorMessage(fbaRes.error),
      awdInventory: toErrorMessage(awdRes.error),
      svdInventory: toErrorMessage(svdRes.error),
      mappings: toErrorMessage(mappingsRes.error),
      velocity: toErrorMessage(velocityRes.error),
      settings: toErrorMessage(settingsRes.error),
      policy: toErrorMessage(policyRes.error),
      sourceState: toErrorMessage(sourceStateRes.error),
    },
  };
}
