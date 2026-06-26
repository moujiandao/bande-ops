/**
 * Reorder recommendation ASSEMBLY: join the three inputs the math needs and run
 * the pure recommender over every catalog SKU.
 *
 *   on-hand   <- inventory_levels   (synced mirror; null = UNKNOWN, never 0)
 *   policy    <- replenishment_settings (per-SKU override over global default)
 *   demand    <- DemandProvider      (FBA ledger aggregate; null = UNKNOWN)
 *
 * Dependencies are INJECTED (a Supabase reader + a DemandProvider) so this is
 * unit-testable with a mocked client + FakeDemandProvider — no live network or
 * DB. Like lib/inventory/sync.ts, this file deliberately does NOT `import
 * 'server-only'` and only depends on the `DemandProvider` *type* (an erased
 * import) from the `./demand` barrel, so it stays loadable in node tests. The
 * real wiring (auth'd client + getDemandProvider) lives in the page.
 *
 * UNKNOWN propagates honestly end to end: a missing inventory row or a null
 * demand becomes a `needs-review` recommendation, NEVER a number. null is never
 * coalesced to 0 anywhere in here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_MARKETPLACE, type Marketplace, type MarketplaceId } from '@/lib/amazon/types';
import { effectiveSetting, type ReplenishmentValues } from '@/lib/settings/resolve';
import { recommend, type Recommendation } from './recommend';
import type { DemandProvider } from './demand';

/** The slice of the Supabase client this assembly actually uses (read-only). */
type ReorderReader = Pick<SupabaseClient, 'from'>;

export interface AssembleRecommendationsDeps {
  /** Authenticated Supabase reader (RLS). In tests, a mock exposing from().select(). */
  supabase: ReorderReader;
  /** Demand source. In tests, a FakeDemandProvider. */
  demand: DemandProvider;
  /** Marketplace to compute for. Defaults to US. */
  marketplace?: Marketplace;
}

/** One assembled recommendation row for the view. */
export interface RecommendationRow {
  marketplaceId: string;
  sku: string;
  title: string;
  /** On-hand as joined from the mirror (null = UNKNOWN). Echoed for the UI. */
  onHand: number | null;
  /** The pure recommender's verdict (discriminated union: ok | needs-review). */
  recommendation: Recommendation;
}

export interface AssembleRecommendationsResult {
  rows: RecommendationRow[];
  /** Non-fatal read errors surfaced so the view can distinguish a failure from genuine UNKNOWN. */
  errors: { catalog?: string; inventory?: string; settings?: string };
}

/**
 * Fallback replenishment policy when there is no global-default row yet. Mirrors
 * the settings page form defaults (14d lead time, 0 safety stock). Kept here so
 * the recommender always has a concrete policy rather than failing on an empty
 * settings table.
 */
const FALLBACK_DEFAULTS: ReplenishmentValues = { leadTimeDays: 14, safetyStock: 0 };

type CatalogRow = { marketplace_id: string; sku: string; title: string };
type InventoryRow = { marketplace_id: string; sku: string; total_quantity: number | null };
type SettingRow = {
  marketplace_id: string;
  sku: string | null;
  lead_time_days: number;
  safety_stock: number;
};

function rowKey(r: { marketplace_id: string; sku: string }): string {
  return `${r.marketplace_id}:${r.sku}`;
}

/**
 * Assemble reorder recommendations for every catalog SKU in the marketplace.
 *
 * Reads the three sources, joins in memory on (marketplace_id, sku), resolves
 * the effective replenishment policy per SKU, fetches demand from the provider,
 * and runs the pure `recommend()` for each. Returns one row per catalog SKU.
 */
export async function assembleRecommendations(
  deps: AssembleRecommendationsDeps,
): Promise<AssembleRecommendationsResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;

  const [catalogRes, inventoryRes, settingsRes] = await Promise.all([
    deps.supabase
      .from('catalog_items')
      .select('marketplace_id, sku, title')
      .eq('marketplace_id', marketplace.id),
    deps.supabase
      .from('inventory_levels')
      .select('marketplace_id, sku, total_quantity')
      .eq('marketplace_id', marketplace.id),
    deps.supabase
      .from('replenishment_settings')
      .select('marketplace_id, sku, lead_time_days, safety_stock')
      .eq('marketplace_id', marketplace.id),
  ]);

  const catalogRows = (catalogRes.data ?? []) as CatalogRow[];
  const inventoryRows = (inventoryRes.data ?? []) as InventoryRow[];
  const settingRows = (settingsRes.data ?? []) as SettingRow[];

  // On-hand by key. A SKU with no inventory row stays UNKNOWN (null) — never 0.
  const onHandByKey = new Map<string, number | null>(
    inventoryRows.map((r) => [rowKey(r), r.total_quantity]),
  );

  // Effective policy: per-SKU override wins over the global default (sku IS NULL).
  const defaultRow = settingRows.find((r) => r.sku === null) ?? null;
  const defaults: ReplenishmentValues = defaultRow
    ? { leadTimeDays: defaultRow.lead_time_days, safetyStock: defaultRow.safety_stock }
    : FALLBACK_DEFAULTS;
  const overrideBySku = new Map<string, ReplenishmentValues>(
    settingRows
      .filter((r): r is SettingRow & { sku: string } => r.sku !== null)
      .map((r) => [r.sku, { leadTimeDays: r.lead_time_days, safetyStock: r.safety_stock }]),
  );

  const rows: RecommendationRow[] = await Promise.all(
    catalogRows.map(async (item) => {
      const key = rowKey(item);
      // Missing inventory row -> UNKNOWN (null), explicitly not 0.
      const onHand = onHandByKey.has(key) ? (onHandByKey.get(key) ?? null) : null;
      const { leadTimeDays, safetyStock } = effectiveSetting(
        overrideBySku.get(item.sku),
        defaults,
      );
      const dailyDemand = await deps.demand.getDailyDemand(
        item.sku,
        item.marketplace_id as MarketplaceId,
      );

      const recommendation = recommend({ onHand, dailyDemand, leadTimeDays, safetyStock });

      return {
        marketplaceId: item.marketplace_id,
        sku: item.sku,
        title: item.title,
        onHand,
        recommendation,
      };
    }),
  );

  return {
    rows,
    errors: {
      catalog: catalogRes.error?.message,
      inventory: inventoryRes.error?.message,
      settings: settingsRes.error?.message,
    },
  };
}
