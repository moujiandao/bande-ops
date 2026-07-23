import type { AmazonClient } from '@/lib/amazon/client';
import { DEFAULT_MARKETPLACE, type Marketplace } from '@/lib/amazon/types';
import {
  mapPolicyRow,
  type ReplenishmentPolicyRow,
} from '@/lib/settings/policy';
import {
  recordSyncAttempt,
  recordSyncFailure,
  recordSyncSuccess,
  type SyncWriter,
} from '@/lib/sync/run';
import { LEGACY_DEFAULTS } from '@/lib/reorder/legacy';
import { calculateSalesVelocity } from './calculate';
import {
  normalizeLedgerRows,
  type FbaDailyVelocityInputRow,
} from './ledger-mapping';
import { buildCatalogSkuIndex, reconcileVelocityRows } from './reconcile-sku';

type DbError = { message: string } | null;

/**
 * The read seam for `replenishment_policy`, kept OUT of the public `admin`
 * type on purpose.
 *
 * Every other sync module writes through the shared structural `SyncWriter`
 * (`from().insert/update/upsert`). This one additionally reads. Declaring that
 * read in the dep type would force TypeScript to structurally check Supabase's
 * generic `select()` builder against this shape wherever a real client is
 * passed in (`app/api/cron/sync/route.ts`), which exceeds the instantiation
 * depth limit and fails `next build`. So the dep stays `SyncWriter` and the
 * read is narrowed at its single point of use below.
 */
type PolicyDb = {
  from(table: string): {
    select(columns?: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: DbError }>;
      };
    };
  };
};

/**
 * The read seam for `catalog_items`, narrowed here for the same reason as
 * {@link PolicyDb}: the `admin` dep stays the shared `SyncWriter` seam (see the
 * "Do not widen a sync module's admin dep" rule in CLAUDE.md) and the multi-row
 * catalog read is narrowed only at its single point of use. `.eq()` resolves
 * directly to `{ data, error }` (no `.single()`), yielding every matching row.
 */
type CatalogDb = {
  from(table: string): {
    select(columns?: string): {
      eq(
        column: string,
        value: string,
      ): PromiseLike<{ data: unknown; error: DbError }>;
    };
  };
};

export interface SyncFbaLedgerVelocityDeps {
  client: Pick<
    AmazonClient,
    'createLedgerReport' | 'getReportUntilDone' | 'downloadReportDocument'
  >;
  admin: SyncWriter;
  marketplace?: Marketplace;
  now?: Date;
}

export interface SyncFbaLedgerVelocityResult {
  ledgerRows: number;
  velocityRows: number;
  syncRunId: string;
}

function groupLedgerRows(
  rows: FbaDailyVelocityInputRow[],
): Map<string, FbaDailyVelocityInputRow[]> {
  const grouped = new Map<string, FbaDailyVelocityInputRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.sku) ?? [];
    existing.push(row);
    grouped.set(row.sku, existing);
  }
  return grouped;
}

export async function syncFbaLedgerVelocity(
  deps: SyncFbaLedgerVelocityDeps,
): Promise<SyncFbaLedgerVelocityResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;
  const syncRunId = await recordSyncAttempt({
    admin: deps.admin,
    source: 'fba_ledger',
    marketplaceId: marketplace.id,
  });

  try {
    // Narrowed here rather than in the dep type — see PolicyDb above.
    const policyRes = await (deps.admin as unknown as PolicyDb)
      .from('replenishment_policy')
      .select('*')
      .eq('marketplace_id', marketplace.id)
      .maybeSingle();
    if (policyRes.error) {
      throw new Error(`syncFbaLedgerVelocity: policy read failed: ${policyRes.error.message}`);
    }
    const policy = mapPolicyRow(
      (policyRes.data ?? null) as ReplenishmentPolicyRow | null,
    );

    const now = deps.now ?? new Date();
    // Fetch the wider of the velocity and legacy windows. calculateSalesVelocity
    // self-limits to velocityMaxLookbackDays, so a longer fetch cannot change
    // velocity — it only lets us see whether a SKU sold at all further back.
    const start = new Date(now);
    start.setUTCDate(
      start.getUTCDate() -
        Math.max(policy.velocityMaxLookbackDays, LEGACY_DEFAULTS.lookbackDays),
    );

    const reportId = await deps.client.createLedgerReport({
      marketplace,
      dataStartTime: start.toISOString(),
      dataEndTime: now.toISOString(),
    });
    const report = await deps.client.getReportUntilDone({ marketplace, reportId });
    const tsv = await deps.client.downloadReportDocument({
      marketplace,
      reportDocumentId: report.reportDocumentId,
    });
    const normalizedRows = normalizeLedgerRows(tsv, {
      marketplaceId: marketplace.id,
      reportId,
      syncRunId,
    });

    // Reconcile Amazon-truncated ledger MSKUs back to canonical catalog SKUs
    // before grouping, so `sales_velocity.sku` joins to `catalog_items` (#27).
    // `catalog_items` has no fn_sku column, so we load only `sku` and the
    // FNSKU cross-reference rule stays dormant (see reconcile-sku.ts).
    const catalogRes = await (deps.admin as unknown as CatalogDb)
      .from('catalog_items')
      .select('sku')
      .eq('marketplace_id', marketplace.id);
    if (catalogRes.error) {
      throw new Error(
        `syncFbaLedgerVelocity: catalog read failed: ${catalogRes.error.message}`,
      );
    }
    const catalogSkuIndex = buildCatalogSkuIndex(
      ((catalogRes.data ?? []) as Array<{ sku?: string | null }>).map((row) => ({
        sku: row.sku ?? '',
      })),
    );
    const ledgerRows = reconcileVelocityRows(normalizedRows, catalogSkuIndex);

    const velocityRows = [...groupLedgerRows(ledgerRows).values()].map((rows) => {
      const first = rows[0];
      const result = calculateSalesVelocity(
        rows.map((row) => ({
          activityDate: row.activity_date,
          customerShipments: row.customer_shipments,
          isInStock: row.is_in_stock,
        })),
        {
          sampleInStockDays: policy.velocitySampleInStockDays,
          maxLookbackDays: policy.velocityMaxLookbackDays,
        },
      );

      return {
        marketplace_id: marketplace.id,
        sku: first.sku,
        fn_sku: first.fn_sku,
        units_shipped: result.unitsShipped,
        in_stock_sample_days: result.inStockSampleDays,
        lookback_days_used: result.lookbackDaysUsed,
        daily_velocity: result.dailyVelocity,
        // Most recent day this SKU actually shipped, across the whole fetched
        // window — null when it never sold in that period.
        last_sold_date:
          rows
            .filter((row) => row.customer_shipments > 0)
            .map((row) => row.activity_date)
            .sort()
            .at(-1) ?? null,
        status: result.status,
        calculated_at: new Date().toISOString(),
        sync_run_id: syncRunId,
      };
    });

    const { error: ledgerError } = await deps.admin
      .from('fba_daily_velocity_inputs')
      .upsert(ledgerRows, { onConflict: 'marketplace_id,sku,activity_date' });
    if (ledgerError) {
      throw new Error(`syncFbaLedgerVelocity: ledger upsert failed: ${ledgerError.message}`);
    }

    const { error: velocityError } = await deps.admin
      .from('sales_velocity')
      .upsert(velocityRows, { onConflict: 'marketplace_id,sku' });
    if (velocityError) {
      throw new Error(
        `syncFbaLedgerVelocity: velocity upsert failed: ${velocityError.message}`,
      );
    }

    await recordSyncSuccess({
      admin: deps.admin,
      source: 'fba_ledger',
      marketplaceId: marketplace.id,
      syncRunId,
      rowCount: ledgerRows.length,
    });
    await recordSyncSuccess({
      admin: deps.admin,
      source: 'sales_velocity',
      marketplaceId: marketplace.id,
      syncRunId,
      rowCount: velocityRows.length,
    });

    return {
      ledgerRows: ledgerRows.length,
      velocityRows: velocityRows.length,
      syncRunId,
    };
  } catch (error) {
    await recordSyncFailure({
      admin: deps.admin,
      source: 'fba_ledger',
      marketplaceId: marketplace.id,
      syncRunId,
      error,
    });
    throw error;
  }
}
