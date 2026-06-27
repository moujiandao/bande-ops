import { describe, it, expect, vi } from 'vitest';
import {
  applyCampaignChange,
  type ApplyCampaignChangeDeps,
  type ApplyCampaignChangeInput,
} from './write';
import type { SessionUser } from '@/lib/auth/types';

// These tests pin the SAFETY CONTRACT of the first write-back to Amazon:
//   1. requireOwner() runs FIRST — a rejected gate means NOTHING is read,
//      logged, or written.
//   2. the audit row is written BEFORE the Amazon write (log-before-write).
//   3. the mirror is re-synced AFTER the write.
//   4. invalid input fails loud before any write.
//
// Deps are injected and instrumented with a shared call-order recorder, so the
// orchestration is verified with no network/DB. The db mock dispatches by table:
// ads_campaigns -> before-read; ads_write_log -> audit insert.

const owner: SessionUser = {
  id: 'owner-1',
  email: 'owner@example.com',
  role: 'owner',
};

function makeDeps(
  overrides: Partial<{
    requireOwner: ApplyCampaignChangeDeps['requireOwner'];
    beforeRow: { state: string; daily_budget: number | null } | null;
    insertError: { message: string } | null;
  }> = {},
) {
  const calls: string[] = [];
  const insertedRows: unknown[] = [];

  const requireOwner =
    overrides.requireOwner ??
    vi.fn(async () => {
      calls.push('auth');
      return owner;
    });

  const beforeRow =
    overrides.beforeRow === undefined
      ? { state: 'enabled', daily_budget: 20 }
      : overrides.beforeRow;
  const insertError = overrides.insertError ?? null;

  const db = {
    from: (table: string) => {
      if (table === 'ads_campaigns') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: beforeRow, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'ads_write_log') {
        return {
          insert: async (row: unknown) => {
            calls.push('log');
            insertedRows.push(row);
            return { error: insertError };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as ApplyCampaignChangeDeps['db'];

  const updateCampaign = vi.fn(async () => {
    calls.push('update');
  });
  const resync = vi.fn(async () => {
    calls.push('resync');
  });

  const deps: ApplyCampaignChangeDeps = {
    requireOwner,
    db,
    updateCampaign,
    resync,
  };

  return { deps, calls, insertedRows, requireOwner, updateCampaign, resync };
}

const pauseInput: ApplyCampaignChangeInput = {
  campaignId: '111111111',
  kind: 'pause',
};

describe('applyCampaignChange — safety contract', () => {
  it('runs in order: authorize -> log -> write -> resync', async () => {
    const { deps, calls } = makeDeps();
    await applyCampaignChange(deps, pauseInput);
    expect(calls).toEqual(['auth', 'log', 'update', 'resync']);
  });

  it('rejects a NON-owner before any read/log/write', async () => {
    const requireOwner = vi.fn(async () => {
      throw new Error('Forbidden: this action requires the owner role.');
    });
    const { deps, calls, updateCampaign, resync } = makeDeps({ requireOwner });

    await expect(applyCampaignChange(deps, pauseInput)).rejects.toThrow(
      /owner role/i,
    );
    expect(calls).toEqual([]); // nothing happened after the gate threw
    expect(updateCampaign).not.toHaveBeenCalled();
    expect(resync).not.toHaveBeenCalled();
  });

  it('writes the audit row BEFORE calling updateCampaign', async () => {
    const { deps, calls } = makeDeps();
    await applyCampaignChange(deps, pauseInput);
    expect(calls.indexOf('log')).toBeLessThan(calls.indexOf('update'));
  });

  it('records actor email, kind, and before/after in the audit row', async () => {
    const { deps, insertedRows } = makeDeps({
      beforeRow: { state: 'enabled', daily_budget: 20 },
    });
    await applyCampaignChange(deps, pauseInput);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      campaign_id: '111111111',
      actor_email: 'owner@example.com',
      change: {
        kind: 'pause',
        before: { state: 'enabled', dailyBudget: 20 },
        after: { state: 'paused', dailyBudget: 20 },
      },
    });
  });

  it('aborts the write when the audit insert fails (log failure is fatal)', async () => {
    const { deps, calls, updateCampaign } = makeDeps({
      insertError: { message: 'rls denied' },
    });
    await expect(applyCampaignChange(deps, pauseInput)).rejects.toThrow(
      /audit log/i,
    );
    expect(updateCampaign).not.toHaveBeenCalled();
    expect(calls).toEqual(['auth', 'log']); // logged-attempt, then aborted
  });

  it('validates a budget change requires a positive budget — before any write', async () => {
    const { deps, calls } = makeDeps();
    await expect(
      applyCampaignChange(deps, {
        campaignId: '111111111',
        kind: 'lower-budget',
      }),
    ).rejects.toThrow(/positive dailyBudget/i);
    // Auth ran, but validation threw before reading/logging/writing.
    expect(calls).toEqual(['auth']);
  });

  it('records a budget change as before->after in the audit row', async () => {
    const { deps, insertedRows } = makeDeps({
      beforeRow: { state: 'enabled', daily_budget: 20 },
    });
    await applyCampaignChange(deps, {
      campaignId: '111111111',
      kind: 'lower-budget',
      dailyBudget: 15,
    });
    expect(insertedRows[0]).toMatchObject({
      change: {
        kind: 'lower-budget',
        before: { state: 'enabled', dailyBudget: 20 },
        after: { state: 'enabled', dailyBudget: 15 },
      },
    });
  });
});
