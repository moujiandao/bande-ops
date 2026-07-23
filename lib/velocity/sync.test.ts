import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';
import {
  syncFbaLedgerVelocity,
  type SyncFbaLedgerVelocityDeps,
} from './sync';

function makeAdminMock(catalogRows: Array<{ sku: string }> = []) {
  const ledgerUpsert = vi.fn().mockResolvedValue({ error: null });
  const velocityUpsert = vi.fn().mockResolvedValue({ error: null });
  const stateUpsert = vi.fn().mockResolvedValue({ error: null });
  const catalogSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: catalogRows, error: null }),
  });
  const runInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
    }),
  });
  const runUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  const policySelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  });
  const from = vi.fn((table: string) => {
    if (table === 'source_sync_runs') {
      return { insert: runInsert, update: runUpdate };
    }
    if (table === 'source_sync_state') return { upsert: stateUpsert };
    if (table === 'replenishment_policy') return { select: policySelect };
    if (table === 'catalog_items') return { select: catalogSelect };
    if (table === 'fba_daily_velocity_inputs') return { upsert: ledgerUpsert };
    if (table === 'sales_velocity') return { upsert: velocityUpsert };
    throw new Error(`Unexpected table: ${table}`);
  });
  return {
    admin: { from } as unknown as SyncFbaLedgerVelocityDeps['admin'],
    ledgerUpsert,
    velocityUpsert,
    stateUpsert,
  };
}

describe('syncFbaLedgerVelocity', () => {
  it('persists daily ledger inputs and calculated velocity', async () => {
    const { admin, ledgerUpsert, velocityUpsert, stateUpsert } = makeAdminMock();
    const client = {
      createLedgerReport: vi.fn().mockResolvedValue('report-1'),
      getReportUntilDone: vi
        .fn()
        .mockResolvedValue({ reportId: 'report-1', reportDocumentId: 'doc-1' }),
      downloadReportDocument: vi.fn().mockResolvedValue(
        [
          'Date\tFNSKU\tMSKU\tDisposition\tCustomer Shipments\tEnding Warehouse Balance',
          '2026-07-21\tFNSKU-1\tSKU-1\tSELLABLE\t3\t7',
          '2026-07-20\tFNSKU-1\tSKU-1\tSELLABLE\t5\t2',
          '2026-07-21\tFNSKU-2\tSKU-2\tSELLABLE\t9\t0',
        ].join('\n'),
      ),
    };

    const result = await syncFbaLedgerVelocity({
      admin,
      client,
      now: new Date('2026-07-21T00:00:00.000Z'),
    });

    expect(client.createLedgerReport).toHaveBeenCalledWith({
      marketplace: DEFAULT_MARKETPLACE,
      dataStartTime: '2025-07-21T00:00:00.000Z',
      dataEndTime: '2026-07-21T00:00:00.000Z',
    });
    expect(ledgerUpsert).toHaveBeenCalledWith(expect.any(Array), {
      onConflict: 'marketplace_id,sku,activity_date',
    });
    expect(velocityUpsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          sku: 'SKU-1',
          units_shipped: 8,
          in_stock_sample_days: 2,
          daily_velocity: 4,
          status: 'ok',
        }),
        expect.objectContaining({
          sku: 'SKU-2',
          units_shipped: null,
          in_stock_sample_days: 0,
          daily_velocity: null,
          status: 'unknown',
        }),
      ]),
      { onConflict: 'marketplace_id,sku' },
    );
    expect(stateUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'sales_velocity',
        status: 'success',
        current_success_run_id: 'run-1',
      }),
      { onConflict: 'source,marketplace_id' },
    );
    expect(result).toEqual({
      ledgerRows: 3,
      velocityRows: 2,
      syncRunId: 'run-1',
    });
  });

  it('reconciles a truncated ledger MSKU to the canonical catalog SKU before upsert', async () => {
    const { admin, ledgerUpsert, velocityUpsert } = makeAdminMock([
      { sku: 'WIDGET-BLUE-LONG-CANONICAL-0001' },
      { sku: 'GADGET-RED-0002' },
    ]);
    const client = {
      createLedgerReport: vi.fn().mockResolvedValue('report-1'),
      getReportUntilDone: vi
        .fn()
        .mockResolvedValue({ reportId: 'report-1', reportDocumentId: 'doc-1' }),
      downloadReportDocument: vi.fn().mockResolvedValue(
        [
          'Date\tFNSKU\tMSKU\tDisposition\tCustomer Shipments\tEnding Warehouse Balance',
          // Amazon truncated the long MSKU; unique catalog-SKU prefix match.
          '2026-07-21\tFNSKU-1\tWIDGET-BLUE-LONG-CAN\tSELLABLE\t3\t7',
          '2026-07-20\tFNSKU-1\tWIDGET-BLUE-LONG-CAN\tSELLABLE\t5\t2',
        ].join('\n'),
      ),
    };

    await syncFbaLedgerVelocity({
      admin,
      client,
      now: new Date('2026-07-21T00:00:00.000Z'),
    });

    // sales_velocity receives the canonical catalog SKU, not the truncated MSKU.
    expect(velocityUpsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ sku: 'WIDGET-BLUE-LONG-CANONICAL-0001' }),
      ]),
      { onConflict: 'marketplace_id,sku' },
    );
    // And the daily ledger inputs are keyed by the same canonical SKU.
    const ledgerArg = ledgerUpsert.mock.calls[0][0] as Array<{ sku: string }>;
    expect(ledgerArg.every((r) => r.sku === 'WIDGET-BLUE-LONG-CANONICAL-0001')).toBe(
      true,
    );
  });

  it('records sanitized failure state when report download fails', async () => {
    const { admin, stateUpsert } = makeAdminMock();
    const client = {
      createLedgerReport: vi.fn().mockResolvedValue('report-1'),
      getReportUntilDone: vi
        .fn()
        .mockResolvedValue({ reportId: 'report-1', reportDocumentId: 'doc-1' }),
      downloadReportDocument: vi
        .fn()
        .mockRejectedValue(new Error('secret-token raw response body')),
    };

    await expect(
      syncFbaLedgerVelocity({
        admin,
        client,
        now: new Date('2026-07-21T00:00:00.000Z'),
      }),
    ).rejects.toThrow('secret-token raw response body');

    expect(stateUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'fba_ledger',
        status: 'failed',
        error_summary: 'Sync failed; check server logs for details.',
      }),
      { onConflict: 'source,marketplace_id' },
    );
  });
});
