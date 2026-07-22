type SyncError = { message: string } | null;

type SyncWriter = {
  from(table: string): {
    insert(payload: unknown): {
      select(columns?: string): {
        single(): Promise<{ data: unknown; error: SyncError }>;
      };
    };
    update(payload: unknown): {
      eq(column: string, value: string): Promise<{ error: SyncError }>;
    };
    upsert(
      payload: unknown,
      options?: { onConflict: string },
    ): Promise<{ error: SyncError }>;
  };
};

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

function errorSummary(_error: unknown): string {
  return 'Sync failed; check server logs for details.';
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
      updated_at: startedAt,
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
      updated_at: finishedAt,
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
      updated_at: finishedAt,
    },
    { onConflict: 'source,marketplace_id' },
  );
  if (stateError) throw new Error(`recordSyncFailure state: ${stateError.message}`);
}
