import { describe, it, expect } from 'vitest';
import { assembleRecommendations, type AssembleRecommendationsDeps } from './service';
import { FakeDemandProvider } from './fake-demand';
import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';

// Assembly tests: join inventory + settings + demand and run the pure
// recommender per catalog SKU. We inject a mocked Supabase reader and a
// FakeDemandProvider — no live DB or network. The invariant under test, end to
// end: a SKU with UNKNOWN on-hand (missing inventory row) or UNKNOWN demand
// surfaces as needs-review, NEVER a number.
//
// NOTE: import FakeDemandProvider from './fake-demand' directly, not the
// './demand' barrel, which pulls SpApiDemandProvider -> 'server-only'.

const mkt = DEFAULT_MARKETPLACE.id;

type TableData = { data: unknown[] | null; error: { message: string } | null };

/**
 * Mock Supabase reader: from(table).select(cols).eq(col,val) resolves to the
 * canned {data,error} for that table. Mirrors the PostgREST chain shape this
 * service uses, with the terminal `.eq()` being the awaited thenable.
 */
function makeSupabaseMock(tables: Record<string, TableData>): AssembleRecommendationsDeps['supabase'] {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      return {
        select() {
          return {
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
        { marketplace_id: mkt, sku: 'SKU-UNKNOWN', title: 'Unknown stock widget' },
      ],
      error: null,
    },
    inventory_levels: {
      data: [
        { marketplace_id: mkt, sku: 'SKU-LOW', total_quantity: 5 },
        { marketplace_id: mkt, sku: 'SKU-HIGH', total_quantity: 100 },
        // SKU-UNKNOWN intentionally absent -> UNKNOWN on-hand (never 0).
      ],
      error: null,
    },
    replenishment_settings: {
      // Global default only: lead 10d, safety 0. ROP = demand*10.
      data: [{ marketplace_id: mkt, sku: null, lead_time_days: 10, safety_stock: 0 }],
      error: null,
    },
  };
}

function makeDeps(
  overrides: Record<string, TableData> = {},
  demandSeed?: Record<string, number | null>,
): AssembleRecommendationsDeps {
  const tables = { ...baseTables(), ...overrides };
  return {
    supabase: makeSupabaseMock(tables),
    demand: new FakeDemandProvider(
      demandSeed ?? { 'SKU-LOW': 2, 'SKU-HIGH': 2, 'SKU-UNKNOWN': 2 },
    ),
  };
}

describe('assembleRecommendations', () => {
  it('recommends a quantity for a low-stock SKU with real demand', async () => {
    const { rows } = await assembleRecommendations(makeDeps());
    const low = rows.find((r) => r.sku === 'SKU-LOW');
    expect(low).toBeDefined();
    expect(low!.title).toBe('Low stock widget');
    expect(low!.onHand).toBe(5);
    expect(low!.recommendation.status).toBe('ok');
    if (low!.recommendation.status === 'ok') {
      // ROP = 2*10 + 0 = 20; 5 <= 20 -> 15
      expect(low!.recommendation.recommendedQty).toBe(15);
      expect(low!.recommendation.reasoning.reorderPoint).toBe(20);
    }
  });

  it('recommends 0 for a well-stocked SKU', async () => {
    const { rows } = await assembleRecommendations(makeDeps());
    const high = rows.find((r) => r.sku === 'SKU-HIGH');
    expect(high!.recommendation.status).toBe('ok');
    if (high!.recommendation.status === 'ok') {
      // ROP = 20; 100 > 20 -> 0
      expect(high!.recommendation.recommendedQty).toBe(0);
    }
  });

  it('surfaces a SKU with no inventory row as needs-review (UNKNOWN on-hand), never a number', async () => {
    const { rows } = await assembleRecommendations(makeDeps());
    const unknown = rows.find((r) => r.sku === 'SKU-UNKNOWN');
    expect(unknown!.onHand).toBeNull();
    expect(unknown!.onHand).not.toBe(0); // the core invariant, made explicit
    expect(unknown!.recommendation.status).toBe('needs-review');
    if (unknown!.recommendation.status === 'needs-review') {
      expect(unknown!.recommendation.reason).toBe('unknown-on-hand');
    }
    // No numeric recommendation leaked onto the row.
    expect('recommendedQty' in unknown!.recommendation).toBe(false);
  });

  it('surfaces a SKU with UNKNOWN demand as needs-review even when on-hand is known', async () => {
    const { rows } = await assembleRecommendations(
      makeDeps(undefined, { 'SKU-LOW': null, 'SKU-HIGH': 2, 'SKU-UNKNOWN': 2 }),
    );
    const low = rows.find((r) => r.sku === 'SKU-LOW');
    expect(low!.onHand).toBe(5); // on-hand is known...
    expect(low!.recommendation.status).toBe('needs-review'); // ...but demand is not
    if (low!.recommendation.status === 'needs-review') {
      expect(low!.recommendation.reason).toBe('unknown-demand');
    }
  });

  it('applies a per-SKU override over the global default', async () => {
    const tables = {
      replenishment_settings: {
        data: [
          { marketplace_id: mkt, sku: null, lead_time_days: 10, safety_stock: 0 },
          // Override SKU-LOW: lead 5, safety 50 -> ROP = 2*5 + 50 = 60.
          { marketplace_id: mkt, sku: 'SKU-LOW', lead_time_days: 5, safety_stock: 50 },
        ],
        error: null,
      } as TableData,
    };
    const { rows } = await assembleRecommendations(makeDeps(tables));
    const low = rows.find((r) => r.sku === 'SKU-LOW');
    if (low!.recommendation.status === 'ok') {
      // ROP = 60; 5 <= 60 -> 55
      expect(low!.recommendation.recommendedQty).toBe(55);
      expect(low!.recommendation.reasoning.reorderPoint).toBe(60);
    } else {
      throw new Error('expected ok');
    }
  });

  it('returns one row per catalog SKU', async () => {
    const { rows } = await assembleRecommendations(makeDeps());
    expect(rows).toHaveLength(3);
  });

  it('surfaces read errors so the view can distinguish failure from genuine UNKNOWN', async () => {
    const { errors } = await assembleRecommendations(
      makeDeps({
        inventory_levels: { data: null, error: { message: 'boom' } },
      }),
    );
    expect(errors.inventory).toBe('boom');
  });
});
