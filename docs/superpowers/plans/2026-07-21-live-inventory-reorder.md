# Live Inventory Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build live-source reorder recommendations from FBA inventory, AWD inventory, FBA ledger velocity, and SVD replenishment inventory.

**Architecture:** Use source-specific synced mirrors, with `source_sync_state` tracking the latest successful run for each source. Keep live Amazon access inside `lib/amazon`, SVD access inside `lib/svd`, and reorder math inside pure `lib/reorder` modules. The UI reads validated snapshots and shows freshness, mappings, velocity sample size, supply breakdown, and review states.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Postgres/RLS, Vitest, server actions, existing `AmazonClient` seam, existing service-role sync pattern.

## Global Constraints

- Fulfillment is FBA-only.
- SVD is replenishment-only and cannot fulfill customer orders.
- Velocity is global, uses the most recent 90 in-stock FBA days, and searches back up to 365 calendar days.
- FBA out-of-stock days are excluded from both velocity numerator and denominator.
- Zero in-stock days returns `Unknown`, never `0`.
- Only FBA fulfillable inventory determines whether a day is in stock.
- AWD and SVD reduce reorder need but never affect the velocity in-stock flag.
- Source joins prioritize `marketplace_id + fn_sku`, then `marketplace_id + seller SKU/MSKU`, then manual SVD mapping.
- Unknown, stale, failed, or unmapped source values produce `Needs review`, not a numeric recommendation.
- Count `inbound_shipped_quantity` and `inbound_receiving_quantity` as usable FBA inbound supply by default.
- Exclude `inbound_working_quantity`, reserved, researching, and unfulfillable inventory from usable supply by default.
- All live source access stays server-side.
- No Restricted Data Token is in scope.
- Do not write back to Amazon.
- Do not expose or log Amazon or SVD secrets.
- Use `apply_patch` for edits.
- Run `npm test` before each commit.
- Run `npm run lint` before the final implementation commit.
- After any task that creates or modifies code files, invoke the code-reviewer subagent with the task description and changed code files. Fix BLOCKING findings before reporting the task complete.

---

## File Structure

Create:

- `supabase/migrations/0010_live_inventory_reorder.sql`: tables and RLS for sync runs, sync state, AWD inventory, ledger inputs, calculated velocity, SVD inventory, source mappings, and global replenishment policy.
- `lib/sync/run.ts`: source sync attempt, success, and failure helpers.
- `lib/settings/policy.ts`: global replenishment policy defaults, row mapping, and form validation.
- `lib/awd/mapping.ts`: pure AWD inventory mapper.
- `lib/awd/sync.ts`: AWD mirror sync.
- `lib/velocity/calculate.ts`: pure 90-in-stock-day velocity calculation.
- `lib/velocity/ledger-mapping.ts`: FBA ledger TSV normalization.
- `lib/velocity/sync.ts`: Reports API driven ledger and velocity sync.
- `lib/amazon/reports.ts`: report request shapes, status types, and ledger report body builder.
- `lib/svd/types.ts`: SVD domain types.
- `lib/svd/config.ts`: server-only SVD credential reader.
- `lib/svd/client.ts`: SVD login and report fetch adapter.
- `lib/svd/parse.ts`: SVD inventory HTML parser.
- `lib/svd/sync.ts`: SVD refresh orchestration.
- `lib/svd/actions.ts`: owner-gated `Refresh SVD` server action.
- `lib/reorder/supply.ts`: pure usable-supply calculation.
- `lib/reorder/mappings.ts`: FNSKU-first source mapping.

Modify:

- `lib/amazon/types.ts`: detailed FBA inventory, AWD inventory, and report types.
- `lib/amazon/client.ts`: SP-API correctness fixes, pagination, detailed inventory, AWD inventory, and Reports API methods.
- `lib/amazon/fake-client.ts`: fake detailed FBA, AWD, and ledger report responses.
- `lib/inventory/mapping.ts`: detailed FBA bucket mapping.
- `lib/inventory/sync.ts`: FBA inventory sync state.
- `lib/cron/sync-all.ts`: scheduled FBA inventory, AWD, ledger velocity, catalog, and ads sync.
- `lib/reorder/recommend.ts`: rename input from `onHand` to `usableSupply` and preserve numeric behavior.
- `lib/reorder/service.ts`: read persisted velocity and multi-source supply, then assemble recommendation rows.
- `app/(app)/reorder/page.tsx`: source health strip, supply breakdown, velocity sample visibility, `Refresh SVD`.
- `app/(app)/settings/page.tsx`: global policy controls and credential configured status.
- `lib/settings/settings-actions.ts`: policy save server action.
- `supabase/README.md`: document new mirrors and policy tables.
- `docs/go-live-readiness.md`: update live readiness checklist.

Delete after Task 5:

- `lib/reorder/demand.ts`
- `lib/reorder/fake-demand.ts`
- `lib/reorder/spapi-demand.ts`

---

### Task 1: Schema, Policy Defaults, And Sync State

**Files:**
- Create: `supabase/migrations/0010_live_inventory_reorder.sql`
- Create: `lib/sync/run.ts`
- Create: `lib/sync/run.test.ts`
- Create: `lib/settings/policy.ts`
- Create: `lib/settings/policy.test.ts`
- Modify: `supabase/README.md`

**Interfaces:**
- Produces: `REPLENISHMENT_POLICY_DEFAULTS: ReplenishmentPolicy`
- Produces: `mapPolicyRow(row: ReplenishmentPolicyRow | null): ReplenishmentPolicy`
- Produces: `validatePolicyInput(input: ReplenishmentPolicyInput): ReplenishmentPolicy`
- Produces: `recordSyncAttempt(input: SyncAttemptInput): Promise<string>`
- Produces: `recordSyncSuccess(input: SyncSuccessInput): Promise<void>`
- Produces: `recordSyncFailure(input: SyncFailureInput): Promise<void>`

- [ ] **Step 1: Write failing policy tests**

Add `lib/settings/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  REPLENISHMENT_POLICY_DEFAULTS,
  mapPolicyRow,
  validatePolicyInput,
} from './policy';

describe('replenishment policy', () => {
  it('defaults to approved global reorder behavior', () => {
    expect(REPLENISHMENT_POLICY_DEFAULTS).toEqual({
      marketplaceId: 'ATVPDKIKX0DER',
      velocitySampleInStockDays: 90,
      velocityMaxLookbackDays: 365,
      fulfillmentMode: 'fba_only',
      svdMode: 'replenishment_only',
      unknownStockMode: 'needs_review',
      staleSourceMode: 'needs_review',
      countInboundWorking: false,
      countInboundShipped: true,
      countInboundReceiving: true,
    });
  });

  it('maps a missing DB row to defaults', () => {
    expect(mapPolicyRow(null)).toEqual(REPLENISHMENT_POLICY_DEFAULTS);
  });

  it('rejects sample days greater than lookback days', () => {
    expect(() =>
      validatePolicyInput({
        velocitySampleInStockDays: 366,
        velocityMaxLookbackDays: 365,
        countInboundWorking: false,
        countInboundShipped: true,
        countInboundReceiving: true,
      }),
    ).toThrow('velocity sample days must be <= max lookback days');
  });
});
```

Run: `npm test -- lib/settings/policy.test.ts`

Expected: FAIL with missing `./policy`.

- [ ] **Step 2: Implement policy module**

Create `lib/settings/policy.ts`:

```ts
import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';

export type FulfillmentMode = 'fba_only';
export type SvdMode = 'replenishment_only';
export type ReviewMode = 'needs_review';

export interface ReplenishmentPolicy {
  marketplaceId: string;
  velocitySampleInStockDays: number;
  velocityMaxLookbackDays: number;
  fulfillmentMode: FulfillmentMode;
  svdMode: SvdMode;
  unknownStockMode: ReviewMode;
  staleSourceMode: ReviewMode;
  countInboundWorking: boolean;
  countInboundShipped: boolean;
  countInboundReceiving: boolean;
}

export interface ReplenishmentPolicyInput {
  velocitySampleInStockDays: number;
  velocityMaxLookbackDays: number;
  countInboundWorking: boolean;
  countInboundShipped: boolean;
  countInboundReceiving: boolean;
}

export interface ReplenishmentPolicyRow {
  marketplace_id: string;
  velocity_sample_in_stock_days: number;
  velocity_max_lookback_days: number;
  fulfillment_mode: FulfillmentMode;
  svd_mode: SvdMode;
  unknown_stock_mode: ReviewMode;
  stale_source_mode: ReviewMode;
  count_inbound_working: boolean;
  count_inbound_shipped: boolean;
  count_inbound_receiving: boolean;
}

export const REPLENISHMENT_POLICY_DEFAULTS: ReplenishmentPolicy = {
  marketplaceId: DEFAULT_MARKETPLACE.id,
  velocitySampleInStockDays: 90,
  velocityMaxLookbackDays: 365,
  fulfillmentMode: 'fba_only',
  svdMode: 'replenishment_only',
  unknownStockMode: 'needs_review',
  staleSourceMode: 'needs_review',
  countInboundWorking: false,
  countInboundShipped: true,
  countInboundReceiving: true,
};

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function validatePolicyInput(
  input: ReplenishmentPolicyInput,
): ReplenishmentPolicy {
  assertPositiveInteger('velocity sample days', input.velocitySampleInStockDays);
  assertPositiveInteger('velocity max lookback days', input.velocityMaxLookbackDays);
  if (input.velocitySampleInStockDays > input.velocityMaxLookbackDays) {
    throw new Error('velocity sample days must be <= max lookback days');
  }
  return { ...REPLENISHMENT_POLICY_DEFAULTS, ...input };
}

export function mapPolicyRow(
  row: ReplenishmentPolicyRow | null,
): ReplenishmentPolicy {
  if (!row) return REPLENISHMENT_POLICY_DEFAULTS;
  return {
    marketplaceId: row.marketplace_id,
    velocitySampleInStockDays: row.velocity_sample_in_stock_days,
    velocityMaxLookbackDays: row.velocity_max_lookback_days,
    fulfillmentMode: row.fulfillment_mode,
    svdMode: row.svd_mode,
    unknownStockMode: row.unknown_stock_mode,
    staleSourceMode: row.stale_source_mode,
    countInboundWorking: row.count_inbound_working,
    countInboundShipped: row.count_inbound_shipped,
    countInboundReceiving: row.count_inbound_receiving,
  };
}
```

Run: `npm test -- lib/settings/policy.test.ts`

Expected: PASS.

- [ ] **Step 3: Write failing sync-state tests**

Add `lib/sync/run.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { recordSyncAttempt, recordSyncFailure, recordSyncSuccess } from './run';

function makeAdmin() {
  const calls: Array<{ table: string; method: string; payload: unknown }> = [];
  return {
    calls,
    admin: {
      from(table: string) {
        return {
          insert(payload: unknown) {
            calls.push({ table, method: 'insert', payload });
            return {
              select() {
                return {
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'run-1' },
                    error: null,
                  }),
                };
              },
            };
          },
          update(payload: unknown) {
            calls.push({ table, method: 'update', payload });
            return { eq: vi.fn().mockResolvedValue({ error: null }) };
          },
          upsert(payload: unknown) {
            calls.push({ table, method: 'upsert', payload });
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
}

describe('sync run helpers', () => {
  it('records attempt, success, and failure as source-agnostic state', async () => {
    const { admin, calls } = makeAdmin();

    const syncRunId = await recordSyncAttempt({
      admin,
      source: 'fba_inventory',
      marketplaceId: 'ATVPDKIKX0DER',
    });

    await recordSyncSuccess({
      admin,
      source: 'fba_inventory',
      marketplaceId: 'ATVPDKIKX0DER',
      syncRunId,
      rowCount: 2,
    });

    await recordSyncFailure({
      admin,
      source: 'fba_inventory',
      marketplaceId: 'ATVPDKIKX0DER',
      syncRunId,
      error: new Error('boom'),
    });

    expect(calls.map((call) => `${call.method}:${call.table}`)).toEqual([
      'insert:source_sync_runs',
      'upsert:source_sync_state',
      'update:source_sync_runs',
      'upsert:source_sync_state',
      'update:source_sync_runs',
      'upsert:source_sync_state',
    ]);
  });
});
```

Run: `npm test -- lib/sync/run.test.ts`

Expected: FAIL with missing `./run`.

- [ ] **Step 4: Implement sync run helpers**

Create `lib/sync/run.ts` with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

type SyncWriter = Pick<SupabaseClient, 'from'>;

export type SourceName =
  | 'fba_inventory'
  | 'awd_inventory'
  | 'fba_ledger'
  | 'sales_velocity'
  | 'svd_inventory';

export interface SyncAttemptInput {
  admin: SyncWriter;
  source: SourceName;
  marketplaceId: string;
}

export interface SyncSuccessInput extends SyncAttemptInput {
  syncRunId: string;
  rowCount: number;
}

export interface SyncFailureInput extends SyncAttemptInput {
  syncRunId: string;
  error: unknown;
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function recordSyncAttempt(input: SyncAttemptInput): Promise<string> {
  const startedAt = new Date().toISOString();
  const { data, error } = await input.admin
    .from('source_sync_runs')
    .insert({
      source: input.source,
      marketplace_id: input.marketplaceId,
      status: 'running',
      started_at: startedAt,
    })
    .select('id')
    .single();
  if (error) throw new Error(`recordSyncAttempt: ${error.message}`);
  const syncRunId = String((data as { id: string }).id);
  const { error: stateError } = await input.admin.from('source_sync_state').upsert(
    {
      source: input.source,
      marketplace_id: input.marketplaceId,
      last_attempt_at: startedAt,
      status: 'running',
      error_summary: null,
    },
    { onConflict: 'source,marketplace_id' },
  );
  if (stateError) throw new Error(`recordSyncAttempt state: ${stateError.message}`);
  return syncRunId;
}

export async function recordSyncSuccess(input: SyncSuccessInput): Promise<void> {
  const finishedAt = new Date().toISOString();
  const { error: runError } = await input.admin
    .from('source_sync_runs')
    .update({
      status: 'success',
      finished_at: finishedAt,
      row_count: input.rowCount,
      error_summary: null,
    })
    .eq('id', input.syncRunId);
  if (runError) throw new Error(`recordSyncSuccess run: ${runError.message}`);
  const { error: stateError } = await input.admin.from('source_sync_state').upsert(
    {
      source: input.source,
      marketplace_id: input.marketplaceId,
      last_success_at: finishedAt,
      current_success_run_id: input.syncRunId,
      status: 'success',
      row_count: input.rowCount,
      error_summary: null,
    },
    { onConflict: 'source,marketplace_id' },
  );
  if (stateError) throw new Error(`recordSyncSuccess state: ${stateError.message}`);
}

export async function recordSyncFailure(input: SyncFailureInput): Promise<void> {
  const finishedAt = new Date().toISOString();
  const summary = errorSummary(input.error);
  const { error: runError } = await input.admin
    .from('source_sync_runs')
    .update({
      status: 'failed',
      finished_at: finishedAt,
      error_summary: summary,
    })
    .eq('id', input.syncRunId);
  if (runError) throw new Error(`recordSyncFailure run: ${runError.message}`);
  const { error: stateError } = await input.admin.from('source_sync_state').upsert(
    {
      source: input.source,
      marketplace_id: input.marketplaceId,
      status: 'failed',
      error_summary: summary,
    },
    { onConflict: 'source,marketplace_id' },
  );
  if (stateError) throw new Error(`recordSyncFailure state: ${stateError.message}`);
}
```

Run: `npm test -- lib/sync/run.test.ts`

Expected: PASS.

- [ ] **Step 5: Add migration**

Create `supabase/migrations/0010_live_inventory_reorder.sql` with tables:

```sql
create table if not exists public.source_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  marketplace_id text not null default 'ATVPDKIKX0DER',
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  row_count integer,
  error_summary text
);

create table if not exists public.source_sync_state (
  source text not null,
  marketplace_id text not null default 'ATVPDKIKX0DER',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  current_success_run_id uuid references public.source_sync_runs(id),
  status text not null check (status in ('running', 'success', 'failed', 'stale')),
  row_count integer,
  error_summary text,
  updated_at timestamptz not null default now(),
  primary key (source, marketplace_id)
);

alter table public.inventory_levels
  add column if not exists fulfillable_quantity integer,
  add column if not exists inbound_working_quantity integer,
  add column if not exists inbound_shipped_quantity integer,
  add column if not exists inbound_receiving_quantity integer,
  add column if not exists reserved_quantity integer,
  add column if not exists researching_quantity integer,
  add column if not exists unfulfillable_quantity integer,
  add column if not exists sync_run_id uuid references public.source_sync_runs(id);

create table if not exists public.awd_inventory_levels (
  marketplace_id text not null default 'ATVPDKIKX0DER',
  sku text not null,
  fn_sku text,
  replenishment_quantity integer,
  total_quantity integer,
  synced_at timestamptz not null default now(),
  sync_run_id uuid references public.source_sync_runs(id),
  primary key (marketplace_id, sku)
);

create table if not exists public.fba_daily_velocity_inputs (
  marketplace_id text not null default 'ATVPDKIKX0DER',
  sku text not null,
  fn_sku text,
  activity_date date not null,
  customer_shipments integer not null,
  sellable_ending_balance integer,
  is_in_stock boolean not null,
  report_id text not null,
  sync_run_id uuid references public.source_sync_runs(id),
  primary key (marketplace_id, sku, activity_date)
);

create table if not exists public.sales_velocity (
  marketplace_id text not null default 'ATVPDKIKX0DER',
  sku text not null,
  fn_sku text,
  units_shipped integer,
  in_stock_sample_days integer not null,
  lookback_days_used integer not null,
  daily_velocity numeric,
  status text not null check (status in ('ok', 'unknown')),
  calculated_at timestamptz not null default now(),
  sync_run_id uuid references public.source_sync_runs(id),
  primary key (marketplace_id, sku)
);

create table if not exists public.svd_inventory_levels (
  svd_item_id text primary key,
  sku text,
  fn_sku text,
  description text not null,
  quantity integer,
  raw_availability text not null,
  refreshed_at timestamptz not null default now(),
  sync_run_id uuid references public.source_sync_runs(id)
);

create table if not exists public.inventory_source_mappings (
  id uuid primary key default gen_random_uuid(),
  marketplace_id text not null default 'ATVPDKIKX0DER',
  amazon_sku text not null,
  fn_sku text,
  svd_item_id text,
  mapping_source text not null check (mapping_source in ('fn_sku', 'sku', 'manual')),
  status text not null check (status in ('active', 'needs_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_source_mappings_unique_source
  on public.inventory_source_mappings (marketplace_id, amazon_sku, coalesce(svd_item_id, ''));

create table if not exists public.replenishment_policy (
  marketplace_id text primary key default 'ATVPDKIKX0DER',
  velocity_sample_in_stock_days integer not null default 90 check (velocity_sample_in_stock_days > 0),
  velocity_max_lookback_days integer not null default 365 check (velocity_max_lookback_days > 0),
  fulfillment_mode text not null default 'fba_only' check (fulfillment_mode = 'fba_only'),
  svd_mode text not null default 'replenishment_only' check (svd_mode = 'replenishment_only'),
  unknown_stock_mode text not null default 'needs_review' check (unknown_stock_mode = 'needs_review'),
  stale_source_mode text not null default 'needs_review' check (stale_source_mode = 'needs_review'),
  count_inbound_working boolean not null default false,
  count_inbound_shipped boolean not null default true,
  count_inbound_receiving boolean not null default true,
  updated_at timestamptz not null default now(),
  check (velocity_sample_in_stock_days <= velocity_max_lookback_days)
);
```

Add RLS:

```sql
alter table public.source_sync_runs enable row level security;
alter table public.source_sync_state enable row level security;
alter table public.awd_inventory_levels enable row level security;
alter table public.fba_daily_velocity_inputs enable row level security;
alter table public.sales_velocity enable row level security;
alter table public.svd_inventory_levels enable row level security;
alter table public.inventory_source_mappings enable row level security;
alter table public.replenishment_policy enable row level security;

create policy "source_sync_runs_select_authenticated" on public.source_sync_runs for select to authenticated using (true);
create policy "source_sync_state_select_authenticated" on public.source_sync_state for select to authenticated using (true);
create policy "awd_inventory_levels_select_authenticated" on public.awd_inventory_levels for select to authenticated using (true);
create policy "fba_daily_velocity_inputs_select_authenticated" on public.fba_daily_velocity_inputs for select to authenticated using (true);
create policy "sales_velocity_select_authenticated" on public.sales_velocity for select to authenticated using (true);
create policy "svd_inventory_levels_select_authenticated" on public.svd_inventory_levels for select to authenticated using (true);
create policy "inventory_source_mappings_select_authenticated" on public.inventory_source_mappings for select to authenticated using (true);
create policy "inventory_source_mappings_insert_authenticated" on public.inventory_source_mappings for insert to authenticated with check (true);
create policy "inventory_source_mappings_update_authenticated" on public.inventory_source_mappings for update to authenticated using (true) with check (true);
create policy "replenishment_policy_select_authenticated" on public.replenishment_policy for select to authenticated using (true);
create policy "replenishment_policy_insert_authenticated" on public.replenishment_policy for insert to authenticated with check (true);
create policy "replenishment_policy_update_authenticated" on public.replenishment_policy for update to authenticated using (true) with check (true);
```

- [ ] **Step 6: Update Supabase docs**

Add to `supabase/README.md`:

```md
### Live replenishment mirrors

FBA inventory, AWD inventory, FBA daily ledger inputs, calculated sales velocity,
and SVD inventory are synced mirrors. Refresh code writes them with the service
role and records source freshness in `source_sync_state`. Reorder calculations
must surface stale, unknown, or unmapped source data as `Needs review`.

`replenishment_policy`, `replenishment_settings`, and
`inventory_source_mappings` are operational data owned by this app.
```

- [ ] **Step 7: Verify and commit**

Run: `npm test -- lib/settings/policy.test.ts lib/sync/run.test.ts`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Invoke code review for changed code files:

- `lib/sync/run.ts`
- `lib/settings/policy.ts`

Commit:

```bash
git add supabase/migrations/0010_live_inventory_reorder.sql lib/sync/run.ts lib/sync/run.test.ts lib/settings/policy.ts lib/settings/policy.test.ts supabase/README.md
git commit -m "feat: add live replenishment schema"
```

---

### Task 2: Detailed FBA Inventory And AWD Sync

**Files:**
- Modify: `lib/amazon/types.ts`
- Modify: `lib/amazon/client.ts`
- Modify: `lib/amazon/fake-client.ts`
- Modify: `lib/amazon/fake-client.test.ts`
- Modify: `lib/inventory/mapping.ts`
- Modify: `lib/inventory/mapping.test.ts`
- Modify: `lib/inventory/sync.ts`
- Modify: `lib/inventory/sync.test.ts`
- Create: `lib/awd/mapping.ts`
- Create: `lib/awd/mapping.test.ts`
- Create: `lib/awd/sync.ts`
- Create: `lib/awd/sync.test.ts`

**Interfaces:**
- Produces: `InventorySummary` with detailed FBA buckets.
- Produces: `AwdInventorySummary`.
- Produces: `AmazonClient.listAwdInventory(opts?: ListAwdInventoryOptions): Promise<AwdInventorySummary[]>`.
- Produces: `syncAwdInventory(deps: SyncAwdInventoryDeps): Promise<SyncAwdInventoryResult>`.
- Consumes: sync-state helpers from Task 1.

- [ ] **Step 1: Write failing FBA mapping test**

In `lib/inventory/mapping.test.ts`, add:

```ts
it('maps detailed FBA buckets and preserves unknown quantities', () => {
  const row = mapInventorySummaryToRow(
    {
      sku: 'SKU-1',
      marketplaceId: 'ATVPDKIKX0DER' as never,
      fnSku: 'FNSKU-1',
      totalQuantity: 20,
      fulfillableQuantity: 7,
      inboundWorkingQuantity: null,
      inboundShippedQuantity: 5,
      inboundReceivingQuantity: 2,
      reservedQuantity: 3,
      researchingQuantity: 1,
      unfulfillableQuantity: 2,
    },
    { syncedAt: new Date('2026-07-21T00:00:00.000Z'), syncRunId: 'run-1' },
  );

  expect(row).toMatchObject({
    fulfillable_quantity: 7,
    inbound_working_quantity: null,
    inbound_shipped_quantity: 5,
    inbound_receiving_quantity: 2,
    reserved_quantity: 3,
    researching_quantity: 1,
    unfulfillable_quantity: 2,
    sync_run_id: 'run-1',
  });
});
```

Run: `npm test -- lib/inventory/mapping.test.ts`

Expected: FAIL because detailed properties are absent.

- [ ] **Step 2: Implement detailed FBA types and mapping**

Patch `lib/amazon/types.ts`:

```ts
export interface InventorySummary {
  sku: string;
  marketplaceId: MarketplaceId;
  totalQuantity: number | null;
  fnSku?: string;
  fulfillableQuantity?: number | null;
  inboundWorkingQuantity?: number | null;
  inboundShippedQuantity?: number | null;
  inboundReceivingQuantity?: number | null;
  reservedQuantity?: number | null;
  researchingQuantity?: number | null;
  unfulfillableQuantity?: number | null;
}

export interface AwdInventorySummary {
  sku: string;
  marketplaceId: MarketplaceId;
  fnSku?: string;
  replenishmentQuantity: number | null;
  totalQuantity: number | null;
}
```

Patch `lib/inventory/mapping.ts` so `InventoryLevelRow` includes the new snake_case fields plus `sync_run_id`, and `mapInventorySummaryToRow()` maps each optional bucket with `?? null`.

Run: `npm test -- lib/inventory/mapping.test.ts`

Expected: PASS.

- [ ] **Step 3: Write failing AWD mapper test**

Create `lib/awd/mapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapAwdInventoryToRows } from './mapping';

describe('mapAwdInventoryToRows', () => {
  it('maps AWD replenishment quantity without treating unknown as zero', () => {
    const rows = mapAwdInventoryToRows(
      [
        {
          sku: 'SKU-1',
          marketplaceId: 'ATVPDKIKX0DER' as never,
          fnSku: 'FNSKU-1',
          replenishmentQuantity: 12,
          totalQuantity: null,
        },
      ],
      { syncedAt: new Date('2026-07-21T00:00:00.000Z'), syncRunId: 'run-1' },
    );

    expect(rows).toEqual([
      {
        marketplace_id: 'ATVPDKIKX0DER',
        sku: 'SKU-1',
        fn_sku: 'FNSKU-1',
        replenishment_quantity: 12,
        total_quantity: null,
        synced_at: '2026-07-21T00:00:00.000Z',
        sync_run_id: 'run-1',
      },
    ]);
  });
});
```

Run: `npm test -- lib/awd/mapping.test.ts`

Expected: FAIL with missing `./mapping`.

- [ ] **Step 4: Implement AWD mapper**

Create `lib/awd/mapping.ts`:

```ts
import type { AwdInventorySummary } from '@/lib/amazon/types';

export interface AwdInventoryLevelRow {
  marketplace_id: string;
  sku: string;
  fn_sku: string | null;
  replenishment_quantity: number | null;
  total_quantity: number | null;
  synced_at: string;
  sync_run_id: string | null;
}

export interface MapAwdInventoryOptions {
  syncedAt?: Date;
  syncRunId?: string;
}

export function mapAwdInventoryToRows(
  summaries: AwdInventorySummary[],
  opts: MapAwdInventoryOptions = {},
): AwdInventoryLevelRow[] {
  const syncedAt = opts.syncedAt ?? new Date();
  return summaries.map((summary) => ({
    marketplace_id: summary.marketplaceId,
    sku: summary.sku,
    fn_sku: summary.fnSku ?? null,
    replenishment_quantity: summary.replenishmentQuantity,
    total_quantity: summary.totalQuantity,
    synced_at: syncedAt.toISOString(),
    sync_run_id: opts.syncRunId ?? null,
  }));
}
```

Run: `npm test -- lib/awd/mapping.test.ts`

Expected: PASS.

- [ ] **Step 5: Add Amazon client request tests**

Create or extend `lib/amazon/client.test.ts` with mocked `fetch` and mocked LWA token. Assert:

```ts
expect(String(requestUrl)).toContain('details=true');
expect(headers).toMatchObject({ 'x-amz-access-token': 'access-token' });
expect(headers).not.toHaveProperty('authorization');
```

Also assert Catalog SKU lookup sends `sellerId` when `sellerSkus` is present, and pagination follows `nextToken`.

Run: `npm test -- lib/amazon/client.test.ts`

Expected: FAIL until the client is fixed.

- [ ] **Step 6: Fix Amazon client inventory, AWD, and pagination**

In `lib/amazon/client.ts`:

- remove the `authorization` header
- add `details: 'true'` to FBA inventory query
- map `inventoryDetails` to the new detailed fields
- add pagination loops for Catalog, FBA inventory, and AWD inventory
- add `sellerId` from config when Catalog uses seller SKU identifiers
- add `listAwdInventory()`

In `lib/amazon/config.ts`, require `SPAPI_SELLER_ID` in live mode and return it from `AmazonConfig`.

Run: `npm test -- lib/amazon`

Expected: PASS.

- [ ] **Step 7: Update fake client and syncs**

In `lib/amazon/fake-client.ts`, seed `BANDE-001` with:

```ts
fulfillableQuantity: 42,
inboundShippedQuantity: 10,
inboundReceivingQuantity: 5,
inboundWorkingQuantity: 0,
reservedQuantity: 0,
researchingQuantity: 0,
unfulfillableQuantity: 0,
```

Add fake AWD rows with `replenishmentQuantity: 25`.

Patch `lib/inventory/sync.ts` to record attempt, success, and failure through `lib/sync/run.ts`.

Create `lib/awd/sync.ts` using the same pattern as `lib/inventory/sync.ts`, writing to `awd_inventory_levels` with conflict key `marketplace_id,sku`.

Add sync tests that assert:

- rows include `sync_run_id`
- success updates `source_sync_state`
- failed upsert calls `recordSyncFailure`

Run: `npm test -- lib/inventory lib/awd lib/amazon lib/sync`

Expected: PASS.

- [ ] **Step 8: Verify, review, and commit**

Run: `npm test`

Expected: PASS.

Invoke code review for changed code files in `lib/amazon`, `lib/inventory`, `lib/awd`, and `lib/sync`.

Commit:

```bash
git add lib/amazon lib/inventory lib/awd lib/sync
git commit -m "feat: sync detailed FBA and AWD inventory"
```

---

### Task 3: FBA Ledger Velocity Mirror

**Files:**
- Create: `lib/amazon/reports.ts`
- Create: `lib/amazon/reports.test.ts`
- Create: `lib/velocity/calculate.ts`
- Create: `lib/velocity/calculate.test.ts`
- Create: `lib/velocity/ledger-mapping.ts`
- Create: `lib/velocity/ledger-mapping.test.ts`
- Create: `lib/velocity/sync.ts`
- Create: `lib/velocity/sync.test.ts`
- Modify: `lib/amazon/client.ts`
- Modify: `lib/amazon/fake-client.ts`

**Interfaces:**
- Produces: `calculateSalesVelocity(rows, policy): SalesVelocityResult`.
- Produces: `normalizeLedgerRows(tsv, opts): FbaDailyVelocityInputRow[]`.
- Produces: `syncFbaLedgerVelocity(deps): Promise<{ ledgerRows: number; velocityRows: number; syncRunId: string }>` .
- Produces Amazon client methods for ledger report creation, polling, document metadata, and document download.

- [ ] **Step 1: Write failing velocity calculator tests**

Create `lib/velocity/calculate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calculateSalesVelocity } from './calculate';

describe('calculateSalesVelocity', () => {
  it('uses recent in-stock days and skips out-of-stock days', () => {
    expect(
      calculateSalesVelocity(
        [
          { activityDate: '2026-07-21', customerShipments: 3, isInStock: true },
          { activityDate: '2026-07-20', customerShipments: 99, isInStock: false },
          { activityDate: '2026-07-19', customerShipments: 5, isInStock: true },
        ],
        { sampleInStockDays: 2, maxLookbackDays: 365 },
      ),
    ).toEqual({
      status: 'ok',
      unitsShipped: 8,
      inStockSampleDays: 2,
      lookbackDaysUsed: 3,
      dailyVelocity: 4,
    });
  });

  it('returns unknown when no days were in stock', () => {
    expect(
      calculateSalesVelocity(
        [{ activityDate: '2026-07-21', customerShipments: 7, isInStock: false }],
        { sampleInStockDays: 90, maxLookbackDays: 365 },
      ),
    ).toEqual({
      status: 'unknown',
      unitsShipped: null,
      inStockSampleDays: 0,
      lookbackDaysUsed: 1,
      dailyVelocity: null,
    });
  });
});
```

Run: `npm test -- lib/velocity/calculate.test.ts`

Expected: FAIL with missing `./calculate`.

- [ ] **Step 2: Implement velocity calculator**

Create `lib/velocity/calculate.ts`:

```ts
export interface VelocityInputDay {
  activityDate: string;
  customerShipments: number;
  isInStock: boolean;
}

export interface VelocityPolicy {
  sampleInStockDays: number;
  maxLookbackDays: number;
}

export type SalesVelocityResult =
  | {
      status: 'ok';
      unitsShipped: number;
      inStockSampleDays: number;
      lookbackDaysUsed: number;
      dailyVelocity: number;
    }
  | {
      status: 'unknown';
      unitsShipped: null;
      inStockSampleDays: number;
      lookbackDaysUsed: number;
      dailyVelocity: null;
    };

export function calculateSalesVelocity(
  inputRows: VelocityInputDay[],
  policy: VelocityPolicy,
): SalesVelocityResult {
  const bounded = [...inputRows]
    .sort((a, b) => b.activityDate.localeCompare(a.activityDate))
    .slice(0, policy.maxLookbackDays);
  const sampled = bounded
    .filter((row) => row.isInStock)
    .slice(0, policy.sampleInStockDays);

  if (sampled.length === 0) {
    return {
      status: 'unknown',
      unitsShipped: null,
      inStockSampleDays: 0,
      lookbackDaysUsed: bounded.length,
      dailyVelocity: null,
    };
  }

  const unitsShipped = sampled.reduce(
    (sum, row) => sum + row.customerShipments,
    0,
  );
  return {
    status: 'ok',
    unitsShipped,
    inStockSampleDays: sampled.length,
    lookbackDaysUsed: bounded.length,
    dailyVelocity: unitsShipped / sampled.length,
  };
}
```

Run: `npm test -- lib/velocity/calculate.test.ts`

Expected: PASS.

- [ ] **Step 3: Write failing ledger normalization tests**

Create `lib/velocity/ledger-mapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeLedgerRows } from './ledger-mapping';

describe('normalizeLedgerRows', () => {
  it('keeps only sellable rows and derives in-stock from sellable ending balance', () => {
    const tsv = [
      'Date\tFNSKU\tMSKU\tDisposition\tCustomer Shipments\tEnding Warehouse Balance',
      '2026-07-21\tFNSKU-1\tSKU-1\tSELLABLE\t3\t7',
      '2026-07-20\tFNSKU-1\tSKU-1\tSELLABLE\t0\t0',
      '2026-07-20\tFNSKU-1\tSKU-1\tUNSELLABLE\t9\t20',
    ].join('\n');

    expect(
      normalizeLedgerRows(tsv, {
        marketplaceId: 'ATVPDKIKX0DER',
        reportId: 'report-1',
        syncRunId: 'run-1',
      }),
    ).toEqual([
      {
        marketplace_id: 'ATVPDKIKX0DER',
        sku: 'SKU-1',
        fn_sku: 'FNSKU-1',
        activity_date: '2026-07-21',
        customer_shipments: 3,
        sellable_ending_balance: 7,
        is_in_stock: true,
        report_id: 'report-1',
        sync_run_id: 'run-1',
      },
      {
        marketplace_id: 'ATVPDKIKX0DER',
        sku: 'SKU-1',
        fn_sku: 'FNSKU-1',
        activity_date: '2026-07-20',
        customer_shipments: 0,
        sellable_ending_balance: 0,
        is_in_stock: false,
        report_id: 'report-1',
        sync_run_id: 'run-1',
      },
    ]);
  });
});
```

Run: `npm test -- lib/velocity/ledger-mapping.test.ts`

Expected: FAIL with missing `./ledger-mapping`.

- [ ] **Step 4: Implement ledger normalization**

Create `lib/velocity/ledger-mapping.ts` with a TSV parser that:

- splits headers by tab
- reads `Date`, `FNSKU`, `MSKU`, `Disposition`, `Customer Shipments`, and `Ending Warehouse Balance`
- ignores non-`SELLABLE` rows
- maps `MSKU` to `sku`
- sets `is_in_stock` to `sellable_ending_balance > 0`
- maps blank or non-numeric ending balance to `null`
- maps blank or non-numeric customer shipments to `0`

Run: `npm test -- lib/velocity/ledger-mapping.test.ts`

Expected: PASS.

- [ ] **Step 5: Add Reports API tests and implementation**

Create `lib/amazon/reports.test.ts` that asserts:

```ts
expect(buildLedgerReportBody({
  marketplaceId: 'ATVPDKIKX0DER',
  dataStartTime: '2025-07-21T00:00:00.000Z',
  dataEndTime: '2026-07-21T00:00:00.000Z',
})).toEqual({
  reportType: 'GET_LEDGER_SUMMARY_VIEW_DATA',
  marketplaceIds: ['ATVPDKIKX0DER'],
  dataStartTime: '2025-07-21T00:00:00.000Z',
  dataEndTime: '2026-07-21T00:00:00.000Z',
  reportOptions: {
    aggregateByLocation: 'COUNTRY',
    aggregatedByTimePeriod: 'DAILY',
  },
});
```

Create `lib/amazon/reports.ts` with `buildLedgerReportBody()` and report status types.

In `lib/amazon/client.ts`, add methods:

- `createLedgerReport({ marketplace, dataStartTime, dataEndTime }): Promise<string>`
- `getReportUntilDone({ marketplace, reportId }): Promise<{ reportId: string; reportDocumentId: string }>`
- `downloadReportDocument({ marketplace, reportDocumentId }): Promise<string>`

Polling must throw on `FATAL` and `CANCELLED`. Document download must call the presigned document URL without Amazon auth headers.

Run: `npm test -- lib/amazon/reports.test.ts lib/amazon/client.test.ts`

Expected: PASS.

- [ ] **Step 6: Implement velocity sync**

Create `lib/velocity/sync.test.ts` with a fake Amazon client returning one report document and a fake admin client. Assert:

- `fba_daily_velocity_inputs` receives normalized daily rows
- `sales_velocity` receives calculated rows
- zero in-stock sample becomes `status: 'unknown'`
- success updates `source_sync_state`
- a failed document download records sync failure and preserves prior successful data by not deleting existing rows

Create `lib/velocity/sync.ts`:

- read `replenishment_policy`
- default through `mapPolicyRow`
- create one ledger report for `now - velocityMaxLookbackDays` through `now`
- poll report
- download report document
- normalize rows
- group rows by SKU with a `Map<string, FbaDailyVelocityInputRow[]>`
- calculate velocity per SKU
- upsert ledger rows into `fba_daily_velocity_inputs`
- upsert calculated rows into `sales_velocity`
- record success for both `fba_ledger` and `sales_velocity`
- record failure for `fba_ledger` on any error

Run: `npm test -- lib/velocity`

Expected: PASS.

- [ ] **Step 7: Verify, review, and commit**

Run: `npm test`

Expected: PASS.

Invoke code review for changed code files in `lib/amazon` and `lib/velocity`.

Commit:

```bash
git add lib/amazon lib/velocity
git commit -m "feat: persist FBA ledger velocity"
```

---

### Task 4: SVD Server-Side Refresh

**Files:**
- Create: `lib/svd/types.ts`
- Create: `lib/svd/config.ts`
- Create: `lib/svd/client.ts`
- Create: `lib/svd/parse.ts`
- Create: `lib/svd/parse.test.ts`
- Create: `lib/svd/sync.ts`
- Create: `lib/svd/sync.test.ts`
- Create: `lib/svd/actions.ts`

**Interfaces:**
- Produces: `SvdInventoryItem`.
- Produces: `parseSvdInventoryHtml(html: string): SvdInventoryItem[]`.
- Produces: `refreshSvdInventory(deps): Promise<{ count: number; syncRunId: string }>` .
- Produces: `refreshSvdInventoryAction(): Promise<void>`.

- [ ] **Step 1: Write failing parser tests**

Create `lib/svd/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseSvdInventoryHtml } from './parse';

describe('parseSvdInventoryHtml', () => {
  it('parses numeric and out-of-stock availability', () => {
    const html = `
      <table>
        <tr><th>Item ID:</th><th>Description:</th><th>Availability:</th></tr>
        <tr><td>babytracker_notebook_boy</td><td>Baby Boy 1 notebook</td><td>7</td></tr>
        <tr><td>babytracker_notebook_girl</td><td>Baby Girl</td><td>Temporarily Out of Stock</td></tr>
      </table>
    `;

    expect(parseSvdInventoryHtml(html)).toEqual([
      {
        svdItemId: 'babytracker_notebook_boy',
        description: 'Baby Boy 1 notebook',
        quantity: 7,
        rawAvailability: '7',
      },
      {
        svdItemId: 'babytracker_notebook_girl',
        description: 'Baby Girl',
        quantity: 0,
        rawAvailability: 'Temporarily Out of Stock',
      },
    ]);
  });

  it('returns null quantity for unrecognized availability', () => {
    const html = '<table><tr><td>x</td><td>X</td><td>Call for availability</td></tr></table>';
    expect(parseSvdInventoryHtml(html)[0].quantity).toBeNull();
  });
});
```

Run: `npm test -- lib/svd/parse.test.ts`

Expected: FAIL with missing `./parse`.

- [ ] **Step 2: Implement parser and types**

Create `lib/svd/types.ts`:

```ts
export interface SvdInventoryItem {
  svdItemId: string;
  sku?: string;
  fnSku?: string;
  description: string;
  quantity: number | null;
  rawAvailability: string;
}
```

Create `lib/svd/parse.ts` with:

- a `clean()` helper that strips tags and collapses whitespace
- a quantity parser where digits map to a number, `Temporarily Out of Stock` maps to `0`, and any other text maps to `null`
- a row parser that reads item id, description, and availability cells
- no fuzzy matching

Run: `npm test -- lib/svd/parse.test.ts`

Expected: PASS.

- [ ] **Step 3: Implement config and client**

Create `lib/svd/config.ts`:

```ts
import 'server-only';

export interface SvdConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export function getSvdConfig(): SvdConfig {
  const baseUrl = process.env.SVD_BASE_URL?.trim() || 'https://svdirect.us';
  const username = process.env.SVD_USERNAME?.trim();
  const password = process.env.SVD_PASSWORD?.trim();
  const missing = [
    username ? null : 'SVD_USERNAME',
    password ? null : 'SVD_PASSWORD',
  ].filter((value): value is string => value !== null);
  if (missing.length > 0) {
    throw new Error(`SVD config missing required env var(s): ${missing.join(', ')}`);
  }
  return { baseUrl, username, password };
}
```

Create `lib/svd/client.ts`:

```ts
import 'server-only';
import { getSvdConfig, type SvdConfig } from './config';

export interface SvdClient {
  fetchInventoryHtml(): Promise<string>;
}

export class HttpSvdClient implements SvdClient {
  constructor(private readonly config: SvdConfig = getSvdConfig()) {}

  async fetchInventoryHtml(): Promise<string> {
    const loginRes = await fetch(`${this.config.baseUrl}/sv5fmsnet/OeCart/OEFrame.asp`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        login: this.config.username,
        password: this.config.password,
      }),
      cache: 'no-store',
    });
    if (!loginRes.ok) throw new Error(`SVD login failed: ${loginRes.status}`);
    const cookie = loginRes.headers.get('set-cookie') ?? '';
    const reportRes = await fetch(
      `${this.config.baseUrl}/sv5fmsnet/OeCart/OEFrame.asp?Action=NEWORDER`,
      { headers: cookie ? { cookie } : undefined, cache: 'no-store' },
    );
    if (!reportRes.ok) throw new Error(`SVD inventory fetch failed: ${reportRes.status}`);
    return reportRes.text();
  }
}
```

If the real SVD login field names differ, change only `HttpSvdClient`. Keep `SvdClient.fetchInventoryHtml()` stable.

- [ ] **Step 4: Write sync tests and implementation**

Create `lib/svd/sync.test.ts` with fake admin/client. Assert:

- successful refresh upserts `svd_inventory_levels`
- `source_sync_state` success is recorded
- parse with zero rows throws
- fetch failure records failure and does not delete prior rows

Create `lib/svd/sync.ts`:

- call `recordSyncAttempt` with `source: 'svd_inventory'`
- fetch HTML
- parse rows
- throw when parsed rows length is `0`
- upsert rows on `svd_item_id`
- record success
- on error record failure and rethrow

Run: `npm test -- lib/svd/sync.test.ts`

Expected: PASS.

- [ ] **Step 5: Add owner-gated server action**

Create `lib/svd/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { HttpSvdClient } from './client';
import { refreshSvdInventory } from './sync';

export async function refreshSvdInventoryAction(): Promise<void> {
  const user = await requireUser();
  if (user.role !== 'owner') {
    throw new Error('Only owners can refresh SVD inventory.');
  }
  await refreshSvdInventory({
    admin: createAdminClient(),
    client: new HttpSvdClient(),
  });
  revalidatePath('/reorder');
}
```

Run: `npm test -- lib/svd`

Expected: PASS.

- [ ] **Step 6: Verify, review, and commit**

Run: `npm test`

Expected: PASS.

Invoke code review for changed code files in `lib/svd`.

Commit:

```bash
git add lib/svd
git commit -m "feat: refresh SVD inventory server-side"
```

---

### Task 5: FNSKU Mapping And Multi-Source Reorder Math

**Files:**
- Create: `lib/reorder/supply.ts`
- Create: `lib/reorder/supply.test.ts`
- Create: `lib/reorder/mappings.ts`
- Create: `lib/reorder/mappings.test.ts`
- Modify: `lib/reorder/recommend.ts`
- Modify: `lib/reorder/recommend.test.ts`
- Modify: `lib/reorder/service.ts`
- Modify: `lib/reorder/service.test.ts`
- Delete: `lib/reorder/demand.ts`
- Delete: `lib/reorder/fake-demand.ts`
- Delete: `lib/reorder/spapi-demand.ts`
- Modify: `app/(app)/reorder/page.tsx`

**Interfaces:**
- Produces: `calculateUsableSupply(input: SupplyInput): UsableSupplyResult`.
- Produces: `resolveSourceMapping(input: ResolveSourceMappingInput): SourceMappingResult`.
- Produces: `assembleRecommendations({ supabase, marketplace }): Promise<AssembleRecommendationsResult>` without `DemandProvider`.

- [ ] **Step 1: Write failing supply tests**

Create `lib/reorder/supply.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calculateUsableSupply } from './supply';

const policy = {
  countInboundWorking: false,
  countInboundShipped: true,
  countInboundReceiving: true,
};

describe('calculateUsableSupply', () => {
  it('counts approved supply buckets', () => {
    expect(
      calculateUsableSupply({
        fba: {
          fulfillableQuantity: 10,
          inboundWorkingQuantity: 99,
          inboundShippedQuantity: 3,
          inboundReceivingQuantity: 2,
        },
        awd: { replenishmentQuantity: 8 },
        svd: { quantity: 7 },
        policy,
      }),
    ).toMatchObject({
      status: 'ok',
      usableSupply: 30,
    });
  });

  it('returns needs-review when a required source is unknown', () => {
    expect(
      calculateUsableSupply({
        fba: {
          fulfillableQuantity: null,
          inboundWorkingQuantity: 0,
          inboundShippedQuantity: 0,
          inboundReceivingQuantity: 0,
        },
        awd: { replenishmentQuantity: 0 },
        svd: { quantity: 0 },
        policy,
      }),
    ).toEqual({ status: 'needs-review', reason: 'unknown-fba-fulfillable' });
  });
});
```

Run: `npm test -- lib/reorder/supply.test.ts`

Expected: FAIL with missing `./supply`.

- [ ] **Step 2: Implement supply module**

Create `lib/reorder/supply.ts` that:

- requires FBA fulfillable
- counts inbound shipped and receiving by default policy
- excludes inbound working unless policy enables it
- requires AWD replenishment quantity
- requires SVD quantity
- returns `{ status: 'needs-review', reason }` for any unknown counted source
- returns an `ok` result with `usableSupply` and a named breakdown

Run: `npm test -- lib/reorder/supply.test.ts`

Expected: PASS.

- [ ] **Step 3: Write failing mapping tests**

Create `lib/reorder/mappings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveSourceMapping } from './mappings';

describe('resolveSourceMapping', () => {
  it('prefers FNSKU over SKU and manual mapping', () => {
    expect(
      resolveSourceMapping({
        amazonSku: 'SKU-1',
        fnSku: 'FNSKU-1',
        svdRows: [
          { svdItemId: 'svd-sku', sku: 'SKU-1', fnSku: null },
          { svdItemId: 'svd-fnsku', sku: 'OTHER', fnSku: 'FNSKU-1' },
        ],
        manualMappings: [{ amazonSku: 'SKU-1', svdItemId: 'svd-manual' }],
      }),
    ).toEqual({
      status: 'mapped',
      svdItemId: 'svd-fnsku',
      mappingSource: 'fn_sku',
    });
  });
});
```

Run: `npm test -- lib/reorder/mappings.test.ts`

Expected: FAIL with missing `./mappings`.

- [ ] **Step 4: Implement mapping module**

Create `lib/reorder/mappings.ts` that:

- accepts `amazonSku`, nullable `fnSku`, SVD candidates, and manual mappings
- first matches SVD candidate by `fnSku`
- then matches SVD candidate by `sku`
- then matches manual mapping by `amazonSku`
- returns `missing-svd-mapping` if nothing matches

Run: `npm test -- lib/reorder/mappings.test.ts`

Expected: PASS.

- [ ] **Step 5: Update recommendation math**

Patch `lib/reorder/recommend.ts`:

- rename `onHand` input to `usableSupply`
- rename reasoning field to `usableSupply`
- keep demand, lead time, safety stock, and rounding behavior unchanged
- change unknown supply reason to `unknown-usable-supply`

Patch `lib/reorder/recommend.test.ts` so existing cases use `usableSupply`.

Run: `npm test -- lib/reorder/recommend.test.ts`

Expected: PASS.

- [ ] **Step 6: Rewrite reorder service**

Patch `lib/reorder/service.test.ts` first. Fake Supabase must return rows for:

- `catalog_items`
- `inventory_levels`
- `awd_inventory_levels`
- `svd_inventory_levels`
- `inventory_source_mappings`
- `sales_velocity`
- `replenishment_settings`
- `replenishment_policy`
- `source_sync_state`

Assert:

```ts
expect(low!.recommendation.status).toBe('ok');
expect(low!.recommendation.reasoning.usableSupply).toBe(30);
expect(low!.recommendation.recommendedQty).toBe(10);
expect(missingMapping!.recommendation).toEqual({
  status: 'needs-review',
  reason: 'missing-svd-mapping',
});
expect(unknownVelocity!.recommendation).toEqual({
  status: 'needs-review',
  reason: 'unknown-demand',
});
```

Patch `lib/reorder/service.ts` so `assembleRecommendations()`:

- removes the `demand` dependency
- reads persisted `sales_velocity`
- reads detailed FBA, AWD, SVD, mappings, policy, settings, and source health
- resolves SVD mapping with FNSKU priority
- computes usable supply
- calls `recommend({ usableSupply, dailyDemand, leadTimeDays, safetyStock })`
- returns `sourceHealth`, `supplyBreakdown`, velocity metadata, and review reasons

Run: `npm test -- lib/reorder/service.test.ts`

Expected: PASS.

- [ ] **Step 7: Remove old demand provider path**

Delete:

- `lib/reorder/demand.ts`
- `lib/reorder/fake-demand.ts`
- `lib/reorder/spapi-demand.ts`

Remove `getDemandProvider()` from `app/(app)/reorder/page.tsx`.

Run: `rg -n "DemandProvider|getDailyDemand|getDemandProvider|spapi-demand|fake-demand" lib app`

Expected: no matches.

- [ ] **Step 8: Verify, review, and commit**

Run: `npm test -- lib/reorder`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Invoke code review for changed code files in `lib/reorder` and `app/(app)/reorder/page.tsx`.

Commit:

```bash
git add lib/reorder 'app/(app)/reorder/page.tsx'
git commit -m "feat: compute reorder from multi-source supply"
```

---

### Task 6: Reorder And Settings UI

**Files:**
- Modify: `app/(app)/reorder/page.tsx`
- Modify: `app/(app)/settings/page.tsx`
- Modify: `lib/settings/settings-actions.ts`
- Modify: `lib/settings/policy.ts`
- Modify: `lib/settings/policy.test.ts`
- Modify: `lib/svd/actions.ts`

**Interfaces:**
- Consumes: `assembleRecommendations()` rows, source health, supply breakdown, and velocity metadata.
- Consumes: `refreshSvdInventoryAction()`.
- Produces: `parsePolicyForm(formData: FormData): ReplenishmentPolicyInput`.
- Produces: `saveReplenishmentPolicyAction(formData: FormData): Promise<void>`.

- [ ] **Step 1: Write failing policy form test**

Patch `lib/settings/policy.test.ts`:

```ts
import { parsePolicyForm } from './policy';

it('parses policy form fields', () => {
  const form = new FormData();
  form.set('velocitySampleInStockDays', '90');
  form.set('velocityMaxLookbackDays', '365');
  form.set('countInboundShipped', 'on');
  form.set('countInboundReceiving', 'on');

  expect(parsePolicyForm(form)).toEqual({
    velocitySampleInStockDays: 90,
    velocityMaxLookbackDays: 365,
    countInboundWorking: false,
    countInboundShipped: true,
    countInboundReceiving: true,
  });
});
```

Run: `npm test -- lib/settings/policy.test.ts`

Expected: FAIL because `parsePolicyForm` is missing.

- [ ] **Step 2: Implement policy form parsing and save action**

Add to `lib/settings/policy.ts`:

```ts
export function parsePolicyForm(formData: FormData): ReplenishmentPolicyInput {
  return validatePolicyInput({
    velocitySampleInStockDays: Number(formData.get('velocitySampleInStockDays')),
    velocityMaxLookbackDays: Number(formData.get('velocityMaxLookbackDays')),
    countInboundWorking: formData.get('countInboundWorking') === 'on',
    countInboundShipped: formData.get('countInboundShipped') === 'on',
    countInboundReceiving: formData.get('countInboundReceiving') === 'on',
  });
}
```

Add to `lib/settings/settings-actions.ts`:

```ts
export async function saveReplenishmentPolicyAction(formData: FormData): Promise<void> {
  await requireUser();
  const supabase = await createClient();
  const policy = parsePolicyForm(formData);
  const { error } = await supabase.from('replenishment_policy').upsert(
    {
      marketplace_id: DEFAULT_MARKETPLACE.id,
      velocity_sample_in_stock_days: policy.velocitySampleInStockDays,
      velocity_max_lookback_days: policy.velocityMaxLookbackDays,
      count_inbound_working: policy.countInboundWorking,
      count_inbound_shipped: policy.countInboundShipped,
      count_inbound_receiving: policy.countInboundReceiving,
      fulfillment_mode: 'fba_only',
      svd_mode: 'replenishment_only',
      unknown_stock_mode: 'needs_review',
      stale_source_mode: 'needs_review',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'marketplace_id' },
  );
  if (error) throw new Error(`saveReplenishmentPolicyAction: ${error.message}`);
  revalidatePath('/settings');
  revalidatePath('/reorder');
}
```

Run: `npm test -- lib/settings`

Expected: PASS.

- [ ] **Step 3: Update settings UI**

Patch `app/(app)/settings/page.tsx` to:

- read `replenishment_policy`
- map the row through `mapPolicyRow`
- render inputs for velocity sample days and max lookback
- render checkboxes for inbound shipped, inbound receiving, and inbound working
- display fixed rules as read-only text: FBA-only, SVD replenishment-only, unknown becomes `Needs review`
- display credential status as configured/not configured, never secret values

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Update reorder UI**

Patch `app/(app)/reorder/page.tsx` to:

- render source health cards before SKU sections
- render an owner-facing `Refresh SVD` form using `refreshSvdInventoryAction`
- render supply breakdown fields on each recommendation row
- render velocity as `X/day from N in-stock days`
- render `Needs review` for missing mapping, unknown supply, unknown velocity, stale source, and read errors

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 5: Verify, review, and commit**

Run: `npm test -- lib/settings lib/reorder lib/svd`

Expected: PASS.

Run: `npm test`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

Invoke code review for changed code files in `app/(app)`, `lib/settings`, and `lib/svd/actions.ts`.

Commit:

```bash
git add 'app/(app)/reorder/page.tsx' 'app/(app)/settings/page.tsx' lib/settings lib/svd/actions.ts
git commit -m "feat: show live reorder source health"
```

---

### Task 7: Cron Wiring, Docs, And Final Verification

**Files:**
- Modify: `lib/cron/sync-all.ts`
- Modify: `lib/cron/sync-all.test.ts`
- Modify: `app/(app)/catalog/actions.ts`
- Modify: `docs/go-live-readiness.md`
- Modify: `supabase/README.md`

**Interfaces:**
- Consumes: `syncInventory`, `syncAwdInventory`, `syncFbaLedgerVelocity`, existing catalog and ads syncs.
- Produces: `runFullSync()` counts for catalog, FBA inventory, AWD inventory, velocity, ads campaigns, and ads campaign metrics.

- [ ] **Step 1: Write failing cron test**

Patch `lib/cron/sync-all.test.ts` so the successful run expects:

```ts
expect(result).toEqual({
  catalog: 2,
  inventory: 2,
  awdInventory: 1,
  velocity: 2,
  adsCampaigns: 2,
  adsCampaignMetrics: 2,
});
```

Run: `npm test -- lib/cron/sync-all.test.ts`

Expected: FAIL because `awdInventory` and `velocity` are absent.

- [ ] **Step 2: Wire syncs into cron**

Patch `lib/cron/sync-all.ts`:

- import `syncAwdInventory`
- import `syncFbaLedgerVelocity`
- widen `FullSyncAmazonClient` to include their client requirements
- run catalog, FBA inventory, AWD inventory, velocity, ads campaigns, and ads metrics sequentially
- return `awdInventory: awdInventory.count`
- return `velocity: velocity.velocityRows`

Run: `npm test -- lib/cron/sync-all.test.ts`

Expected: PASS.

- [ ] **Step 3: Check manual catalog sync wording**

Open `app/(app)/catalog/actions.ts`.

If the action only claims to sync catalog or FBA inventory, leave it scoped. If the UI/action copy claims to sync all live sources, patch the copy or action so it is truthful:

- catalog sync means catalog and FBA inventory
- reorder source refreshes are cron plus SVD button
- no UI should imply that SVD refreshes automatically

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Update readiness docs**

Patch `docs/go-live-readiness.md` with a live reorder checklist:

```md
### Reorder live-source readiness

The live path uses detailed FBA inventory, AWD inventory, FBA daily ledger
velocity, and SVD replenishment inventory as separate mirrors. Before flipping
`AMAZON_USE_FAKE=false`, verify:

- Catalog SKU lookup includes `sellerId`
- FBA inventory includes `details=true`
- AWD inventory paginates
- FBA ledger report creates, polls, downloads, and parses
- SVD refresh succeeds with server-side credentials
- Reorder rows show `Needs review` for unknown, stale, or unmapped inputs
```

- [ ] **Step 5: Final verification**

Run: `npm test`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

Run:

```bash
git grep -n "SVD_PASSWORD\\|SPAPI_REFRESH_TOKEN\\|LWA_CLIENT_SECRET" -- . ':!docs/superpowers/plans/2026-07-21-live-inventory-reorder.md'
```

Expected: only env var names in config/docs, no hardcoded secret values.

Run:

```bash
rg -n "DemandProvider|getDailyDemand|getDemandProvider|spapi-demand|fake-demand" lib app
```

Expected: no matches.

Run:

```bash
npm test -- lib/reorder/mappings.test.ts lib/velocity/calculate.test.ts lib/svd/parse.test.ts
```

Expected: PASS.

- [ ] **Step 6: Code review gate and commit**

Invoke code review for changed code files in `lib/cron` and `app/(app)/catalog/actions.ts`.

Commit:

```bash
git add lib/cron 'app/(app)/catalog/actions.ts' docs/go-live-readiness.md supabase/README.md
git commit -m "feat: wire live reorder syncs"
```

---

## Execution Choice

Plan complete when this file passes self-review. Implementation should happen task-by-task, with a review gate after every task that touches code.

Execution options:

1. **Subagent-Driven (recommended)**: dispatch a fresh subagent per task, review between tasks, fastest for this many independent slices.
2. **Inline Execution**: execute tasks in this session using `superpowers:executing-plans`, with checkpoints between tasks.

