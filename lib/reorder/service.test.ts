import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';
import { assembleRecommendations, type AssembleRecommendationsDeps } from './service';

const mkt = DEFAULT_MARKETPLACE.id;

type TableData = { data: unknown[] | null; error: { message: string } | null };

function makeSupabaseMock(
  tables: Record<string, TableData>,
): AssembleRecommendationsDeps['supabase'] {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      return {
        select() {
          const promise = Promise.resolve(result);
          return {
            then: promise.then.bind(promise),
            catch: promise.catch.bind(promise),
            finally: promise.finally.bind(promise),
            eq() {
              return Promise.resolve(result);
            },
          };
        },
      };
    },
  } as unknown as AssembleRecommendationsDeps['supabase'];
}

function baseTables(): Record<string, TableData> {
  return {
    catalog_items: {
      data: [
        { marketplace_id: mkt, sku: 'SKU-LOW', title: 'Low stock widget' },
        { marketplace_id: mkt, sku: 'SKU-HIGH', title: 'Well stocked widget' },
        { marketplace_id: mkt, sku: 'SKU-MISSING-MAP', title: 'Missing map widget' },
      ],
      error: null,
    },
    inventory_levels: {
      data: [
        {
          marketplace_id: mkt,
          sku: 'SKU-LOW',
          fn_sku: 'FNSKU-LOW',
          fulfillable_quantity: 5,
          inbound_working_quantity: 99,
          inbound_shipped_quantity: 3,
          inbound_receiving_quantity: 2,
        },
        {
          marketplace_id: mkt,
          sku: 'SKU-HIGH',
          fn_sku: 'FNSKU-HIGH',
          fulfillable_quantity: 100,
          inbound_working_quantity: 0,
          inbound_shipped_quantity: 0,
          inbound_receiving_quantity: 0,
        },
        {
          marketplace_id: mkt,
          sku: 'SKU-MISSING-MAP',
          fn_sku: 'FNSKU-MISSING-MAP',
          fulfillable_quantity: 5,
          inbound_working_quantity: 0,
          inbound_shipped_quantity: 0,
          inbound_receiving_quantity: 0,
        },
      ],
      error: null,
    },
    awd_inventory_levels: {
      data: [
        {
          marketplace_id: mkt,
          sku: 'SKU-LOW',
          fn_sku: 'FNSKU-LOW',
          replenishment_quantity: 0,
          available_distributable_quantity: 8,
        },
        {
          marketplace_id: mkt,
          sku: 'SKU-HIGH',
          fn_sku: 'FNSKU-HIGH',
          replenishment_quantity: 0,
          available_distributable_quantity: 50,
        },
      ],
      error: null,
    },
    svd_inventory_levels: {
      data: [
        { svd_item_id: 'svd-low', sku: 'DIFFERENT-SKU', fn_sku: 'FNSKU-LOW', quantity: 7 },
        { svd_item_id: 'svd-high', sku: 'SKU-HIGH', fn_sku: null, quantity: 20 },
      ],
      error: null,
    },
    inventory_source_mappings: {
      data: [],
      error: null,
    },
    sales_velocity: {
      data: [
        {
          marketplace_id: mkt,
          sku: 'SKU-LOW',
          daily_velocity: 4,
          status: 'ok',
          in_stock_sample_days: 90,
        },
        {
          marketplace_id: mkt,
          sku: 'SKU-HIGH',
          daily_velocity: 2,
          status: 'ok',
          in_stock_sample_days: 90,
        },
        {
          marketplace_id: mkt,
          sku: 'SKU-MISSING-MAP',
          daily_velocity: 1,
          status: 'ok',
          in_stock_sample_days: 90,
        },
      ],
      error: null,
    },
    replenishment_settings: {
      data: [
        {
          marketplace_id: mkt,
          sku: null,
          lead_time_days: 10,
          safety_stock: 0,
          target_coverage_days: 30,
          // The global default row never carries a pack size: it is a physical
          // per-product fact, so it deliberately has no global fallback.
          svd_units_per_box: null,
        },
        {
          marketplace_id: mkt,
          sku: 'SKU-LOW',
          lead_time_days: 10,
          safety_stock: 0,
          target_coverage_days: null,
          svd_units_per_box: 2,
        },
        {
          marketplace_id: mkt,
          sku: 'SKU-HIGH',
          lead_time_days: 10,
          safety_stock: 0,
          target_coverage_days: null,
          svd_units_per_box: 5,
        },
      ],
      error: null,
    },
    replenishment_policy: {
      data: [],
      error: null,
    },
    source_sync_state: {
      data: [
        {
          source: 'fba_inventory',
          status: 'success',
          last_success_at: '2026-07-21T00:00:00.000Z',
          row_count: 3,
          error_summary: null,
        },
        {
          source: 'awd_inventory',
          status: 'success',
          last_success_at: '2026-07-21T00:00:00.000Z',
          row_count: 2,
          error_summary: null,
        },
        {
          source: 'fba_ledger',
          status: 'success',
          last_success_at: '2026-07-21T00:00:00.000Z',
          row_count: 3,
          error_summary: null,
        },
        {
          source: 'svd_inventory',
          status: 'success',
          last_success_at: '2026-07-21T00:00:00.000Z',
          row_count: 2,
          error_summary: null,
        },
      ],
      error: null,
    },
  };
}

function makeDeps(
  overrides: Record<string, TableData> = {},
): AssembleRecommendationsDeps {
  return {
    supabase: makeSupabaseMock({ ...baseTables(), ...overrides }),
  };
}

describe('assembleRecommendations', () => {
  it('computes reorder from FBA, AWD, SVD, and persisted velocity', async () => {
    const { rows } = await assembleRecommendations(makeDeps());
    const low = rows.find((row) => row.sku === 'SKU-LOW');

    expect(low).toBeDefined();
    expect(low!.sourceMapping).toEqual({
      status: 'mapped',
      svdItemId: 'svd-low',
      mappingSource: 'fn_sku',
    });
    // 7 SVD BOXES at 2 units per box = 14 units, not 7.
    expect(low!.sources.svd).toBe(14);
    expect(low!.svdBoxes).toBe(7);
    expect(low!.svdUnitsPerBox).toBe(2);
    expect(low!.usableSupply).toBe(32);
    expect(low!.dailyDemand).toBe(4);
    expect(low!.velocitySampleDays).toBe(90);
    expect(low!.supplyBreakdown).toEqual({
      fbaFulfillable: 5,
      fbaInboundWorking: 0,
      fbaInboundShipped: 3,
      fbaInboundReceiving: 2,
      awdAvailable: 8,
      awdReplenishment: 0,
      svdAvailable: 14,
    });
    expect(low!.recommendation.status).toBe('ok');
    if (low!.recommendation.status === 'ok') {
      // (s,S): trigger s = 4*10 + 0 = 40; below it (supply 32), so reorder.
      // Coverage target S = dailyDemand 4 * 30 days = 120; fill 120 - 32 = 88.
      expect(low!.recommendation.reasoning.reorderPoint).toBe(40);
      expect(low!.recommendation.reasoning.coverageDays).toBe(30);
      expect(low!.recommendation.reasoning.targetStock).toBe(120);
      expect(low!.recommendation.reasoning.orderUpToLevel).toBe(120);
      expect(low!.recommendation.recommendedQty).toBe(88);
    }
  });

  it('keeps well-stocked SKUs at zero reorder quantity', async () => {
    const { rows } = await assembleRecommendations(makeDeps());
    const high = rows.find((row) => row.sku === 'SKU-HIGH');

    // 20 SVD boxes at 5 units per box = 100 units, replacing the raw 20.
    expect(high!.usableSupply).toBe(250);
    expect(high!.recommendation.status).toBe('ok');
    if (high!.recommendation.status === 'ok') {
      expect(high!.recommendation.recommendedQty).toBe(0);
    }
  });

  it('needs review when a SKU with SVD stock has no pack size', async () => {
    const { rows } = await assembleRecommendations(
      makeDeps({
        replenishment_settings: {
          data: [
            {
              marketplace_id: mkt,
              sku: null,
              lead_time_days: 10,
              safety_stock: 0,
              target_coverage_days: 30,
              svd_units_per_box: null,
            },
          ],
          error: null,
        },
      }),
    );
    const low = rows.find((row) => row.sku === 'SKU-LOW');

    expect(low!.recommendation).toEqual({
      status: 'needs-review',
      reason: 'unknown-svd-units-per-box',
    });
    expect(low!.usableSupply).toBeNull();
    // The box count is still known and still worth showing; only the unit
    // conversion is unavailable.
    expect(low!.svdBoxes).toBe(7);
    expect(low!.sources.svd).toBeNull();
  });

  it('inherits lead time and safety stock when a per-SKU row overrides only the box size', async () => {
    // The seed writes rows carrying ONLY svd_units_per_box, with lead time and
    // safety stock null. Those must fall back to the global default, not act as
    // overrides pinned to null.
    const { rows } = await assembleRecommendations(
      makeDeps({
        replenishment_settings: {
          data: [
            {
              marketplace_id: mkt,
              sku: null,
              lead_time_days: 10,
              safety_stock: 12,
              target_coverage_days: 30,
              svd_units_per_box: null,
            },
            {
              marketplace_id: mkt,
              sku: 'SKU-LOW',
              lead_time_days: null,
              safety_stock: null,
              target_coverage_days: null,
              svd_units_per_box: 2,
            },
          ],
          error: null,
        },
      }),
    );
    const low = rows.find((row) => row.sku === 'SKU-LOW');

    expect(low!.recommendation.status).toBe('ok');
    if (low!.recommendation.status === 'ok') {
      // s = dailyDemand 4 * leadTime 10 + safetyStock 12 = 52, both inherited
      // from the default. A pinned-null override would have thrown or zeroed these.
      expect(low!.recommendation.reasoning.reorderPoint).toBe(52);
    }
  });

  it('flags SKUs without an SVD mapping for review', async () => {
    const { rows } = await assembleRecommendations(makeDeps());
    const missing = rows.find((row) => row.sku === 'SKU-MISSING-MAP');

    expect(missing!.recommendation.status).toBe('needs-review');
    if (missing!.recommendation.status === 'needs-review') {
      expect(missing!.recommendation.reason).toBe('missing-svd-mapping');
    }
  });

  it('uses manual mappings after FNSKU and SKU matching', async () => {
    const { rows } = await assembleRecommendations(
      makeDeps({
        svd_inventory_levels: {
          data: [
            { svd_item_id: 'manual-svd', sku: null, fn_sku: null, quantity: 7 },
            { svd_item_id: 'svd-high', sku: 'SKU-HIGH', fn_sku: null, quantity: 20 },
          ],
          error: null,
        },
        inventory_source_mappings: {
          data: [
            {
              marketplace_id: mkt,
              amazon_sku: 'SKU-LOW',
              svd_item_id: 'manual-svd',
              status: 'active',
            },
          ],
          error: null,
        },
      }),
    );
    const low = rows.find((row) => row.sku === 'SKU-LOW');

    expect(low!.sourceMapping).toEqual({
      status: 'mapped',
      svdItemId: 'manual-svd',
      mappingSource: 'manual',
    });
  });

  it('surfaces unknown velocity as unknown demand', async () => {
    const { rows } = await assembleRecommendations(
      makeDeps({
        sales_velocity: {
          data: [
            {
              marketplace_id: mkt,
              sku: 'SKU-LOW',
              daily_velocity: null,
              status: 'unknown',
              in_stock_sample_days: 0,
            },
          ],
          error: null,
        },
      }),
    );
    const low = rows.find((row) => row.sku === 'SKU-LOW');

    expect(low!.dailyDemand).toBeNull();
    expect(low!.recommendation.status).toBe('needs-review');
    if (low!.recommendation.status === 'needs-review') {
      expect(low!.recommendation.reason).toBe('unknown-demand');
    }
  });

  it('blocks numeric recommendations when a required source is not fresh', async () => {
    const { rows } = await assembleRecommendations(
      makeDeps({
        source_sync_state: {
          data: [
            {
              source: 'fba_inventory',
              status: 'success',
              last_success_at: '2026-07-21T00:00:00.000Z',
              row_count: 3,
              error_summary: null,
            },
            {
              source: 'awd_inventory',
              status: 'failed',
              last_success_at: '2026-07-20T00:00:00.000Z',
              row_count: 2,
              error_summary: 'Sync failed; check server logs for details.',
            },
          ],
          error: null,
        },
      }),
    );
    const low = rows.find((row) => row.sku === 'SKU-LOW');

    expect(low!.usableSupply).toBeNull();
    expect(low!.recommendation.status).toBe('needs-review');
    if (low!.recommendation.status === 'needs-review') {
      expect(low!.recommendation.reason).toBe('stale-source-awd_inventory');
    }
    expect('recommendedQty' in low!.recommendation).toBe(false);
  });

  it('blocks numeric recommendations when a required source has never synced', async () => {
    const { rows } = await assembleRecommendations(
      makeDeps({
        source_sync_state: {
          data: [
            {
              source: 'fba_inventory',
              status: 'success',
              last_success_at: '2026-07-21T00:00:00.000Z',
              row_count: 3,
              error_summary: null,
            },
            {
              source: 'awd_inventory',
              status: 'success',
              last_success_at: '2026-07-21T00:00:00.000Z',
              row_count: 2,
              error_summary: null,
            },
            {
              source: 'fba_ledger',
              status: 'success',
              last_success_at: '2026-07-21T00:00:00.000Z',
              row_count: 3,
              error_summary: null,
            },
          ],
          error: null,
        },
      }),
    );
    const low = rows.find((row) => row.sku === 'SKU-LOW');

    expect(low!.recommendation.status).toBe('needs-review');
    if (low!.recommendation.status === 'needs-review') {
      expect(low!.recommendation.reason).toBe('stale-source-svd_inventory');
    }
  });

  it('blocks numeric recommendations when source freshness cannot be read', async () => {
    const { rows, errors } = await assembleRecommendations(
      makeDeps({
        source_sync_state: { data: null, error: { message: 'freshness read failed' } },
      }),
    );
    const low = rows.find((row) => row.sku === 'SKU-LOW');

    expect(errors.sourceState).toBe('freshness read failed');
    expect(low!.recommendation.status).toBe('needs-review');
    if (low!.recommendation.status === 'needs-review') {
      expect(low!.recommendation.reason).toBe('stale-source-source_sync_state');
    }
  });

  it('returns source health for the UI', async () => {
    const { sourceHealth } = await assembleRecommendations(makeDeps());
    expect(sourceHealth).toEqual([
      {
        source: 'fba_inventory',
        status: 'success',
        lastSuccessAt: '2026-07-21T00:00:00.000Z',
        rowCount: 3,
        errorSummary: null,
      },
      {
        source: 'awd_inventory',
        status: 'success',
        lastSuccessAt: '2026-07-21T00:00:00.000Z',
        rowCount: 2,
        errorSummary: null,
      },
      {
        source: 'fba_ledger',
        status: 'success',
        lastSuccessAt: '2026-07-21T00:00:00.000Z',
        rowCount: 3,
        errorSummary: null,
      },
      {
        source: 'svd_inventory',
        status: 'success',
        lastSuccessAt: '2026-07-21T00:00:00.000Z',
        rowCount: 2,
        errorSummary: null,
      },
    ]);
  });

  it('surfaces read errors so the view can distinguish failure from unknown data', async () => {
    const { errors } = await assembleRecommendations(
      makeDeps({
        inventory_levels: { data: null, error: { message: 'boom' } },
      }),
    );
    expect(errors.fbaInventory).toBe('boom');
  });
});
