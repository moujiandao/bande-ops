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
