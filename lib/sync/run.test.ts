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
  it('records attempt and success payloads with source, marketplace, state, and row count', async () => {
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

    expect(calls.map((call) => `${call.method}:${call.table}`)).toEqual([
      'insert:source_sync_runs',
      'upsert:source_sync_state',
      'update:source_sync_runs',
      'upsert:source_sync_state',
    ]);
    expect(calls).toEqual([
      {
        table: 'source_sync_runs',
        method: 'insert',
        payload: {
          source: 'fba_inventory',
          marketplace_id: 'ATVPDKIKX0DER',
          status: 'running',
          started_at: expect.any(String),
        },
      },
      {
        table: 'source_sync_state',
        method: 'upsert',
        payload: {
          source: 'fba_inventory',
          marketplace_id: 'ATVPDKIKX0DER',
          last_attempt_at: expect.any(String),
          status: 'running',
          error_summary: null,
          updated_at: expect.any(String),
        },
      },
      {
        table: 'source_sync_runs',
        method: 'update',
        payload: {
          status: 'success',
          finished_at: expect.any(String),
          row_count: 2,
          error_summary: null,
        },
      },
      {
        table: 'source_sync_state',
        method: 'upsert',
        payload: {
          source: 'fba_inventory',
          marketplace_id: 'ATVPDKIKX0DER',
          last_success_at: expect.any(String),
          current_success_run_id: 'run-1',
          status: 'success',
          row_count: 2,
          error_summary: null,
          updated_at: expect.any(String),
        },
      },
    ]);
  });

  it('persists a generic failure summary without raw upstream error content', async () => {
    const { admin, calls } = makeAdmin();
    const rawError = 'Amazon response: {"access_token":"super-secret-token"}';

    await recordSyncFailure({
      admin,
      source: 'fba_inventory',
      marketplaceId: 'ATVPDKIKX0DER',
      syncRunId: 'run-1',
      error: new Error(rawError),
    });

    expect(calls.map((call) => `${call.method}:${call.table}`)).toEqual([
      'update:source_sync_runs',
      'upsert:source_sync_state',
    ]);
    expect(calls).toEqual([
      {
        table: 'source_sync_runs',
        method: 'update',
        payload: {
          status: 'failed',
          finished_at: expect.any(String),
          error_summary: 'Sync failed; check server logs for details.',
        },
      },
      {
        table: 'source_sync_state',
        method: 'upsert',
        payload: {
          source: 'fba_inventory',
          marketplace_id: 'ATVPDKIKX0DER',
          status: 'failed',
          error_summary: 'Sync failed; check server logs for details.',
          updated_at: expect.any(String),
        },
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain(rawError);
    expect(JSON.stringify(calls)).not.toContain('super-secret-token');
  });
});
