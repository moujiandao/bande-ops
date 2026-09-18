import { describe, expect, it, vi } from 'vitest';
import { readShipmentAdjustments, readShipmentEvidenceStatus, reconciledExcludedUnits, type AdjustmentRow } from './read';
import type { SupabaseClient } from '@supabase/supabase-js';

const now = new Date('2026-09-17T18:00:00Z');
const row: AdjustmentRow = { marketplace_id: 'ATVPDKIKX0DER', sku: 'SKU', activity_date: '2026-09-15', ledger_units: 5,
  shipment_units: 5, excluded_units: 3, vine_units: 3, status: 'complete', issue: null, classification_version: 1 };
const complete = { status: 'complete', end_date: '2026-09-15', classification_version: 1, completed_at: now.toISOString() };
function db(batches: unknown[], pages: unknown[][] = [], failure = false) {
  const query = {
    eq: vi.fn(() => query), gte: vi.fn(() => query), lte: vi.fn(() => query), order: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue({ data: batches, error: failure ? { message: 'DB error' } : null }),
    range: vi.fn().mockImplementation(() => Promise.resolve({ data: pages.shift() ?? [], error: failure ? { message: 'DB error' } : null })),
  };
  return { supabase: { from: vi.fn(() => ({ select: vi.fn(() => query) })) } as unknown as Pick<SupabaseClient, 'from'>, query };
}

describe('persisted adjustment evidence', () => {
  it('invalidates adjustments after a ledger correction, schema-version change, or unknown match', () => {
    const ledger = { marketplace_id: row.marketplace_id, customer_shipments: 5 };
    expect(reconciledExcludedUnits(ledger, row)).toBe(3);
    expect(reconciledExcludedUnits({ ...ledger, customer_shipments: 6 }, row)).toBeNull();
    expect(reconciledExcludedUnits(ledger, { ...row, classification_version: 0 })).toBeNull();
    expect(reconciledExcludedUnits(ledger, { ...row, status: 'unknown' })).toBeNull();
    expect(reconciledExcludedUnits(ledger, undefined)).toBeNull();
    expect(reconciledExcludedUnits(ledger, { ...row, excluded_units: 0 })).toBe(0);
  });
  it('allows fresh completed evidence while another generation processes', async () => {
    expect(await readShipmentEvidenceStatus(db([{ status: 'pending' }, complete]).supabase, now))
      .toMatchObject({ currentIssue: null, pending: true, throughDate: '2026-09-15' });
  });
  it('blocks current claims after source failure, stale evidence, or a missing migration', async () => {
    expect((await readShipmentEvidenceStatus(db([{ status: 'failed' }, complete]).supabase, now)).currentIssue).toContain('failed');
    expect((await readShipmentEvidenceStatus(db([{ ...complete, completed_at: '2026-09-14T00:00:00Z' }]).supabase, now)).currentIssue).toContain('48 hours');
    expect((await readShipmentEvidenceStatus(db([], [], true).supabase, now)).currentIssue).toContain('0023');
    expect((await readShipmentEvidenceStatus(db([{ ...complete, end_date: '2026-09-10' }]).supabase, now)).currentIssue).toContain('catching up');
  });
  it('paginates beyond 1000 rows without defaulting absent evidence to zero', async () => {
    const mock = db([complete], [Array.from({ length: 1000 }, () => row), [{ ...row, sku: 'LAST' }]]);
    const result = await readShipmentAdjustments({ supabase: mock.supabase, now, startDate: '2026-01-01', endDate: '2026-09-16' });
    expect(result.rows).toHaveLength(1001);
    expect(mock.query.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });
});
