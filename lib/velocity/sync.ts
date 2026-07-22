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
import { calculateSalesVelocity } from './calculate';
import {
  normalizeLedgerRows,
  type FbaDailyVelocityInputRow,
} from './ledger-mapping';

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
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - policy.velocityMaxLookbackDays);

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
    const ledgerRows = normalizeLedgerRows(tsv, {
      marketplaceId: marketplace.id,
      reportId,
      syncRunId,
    });

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
