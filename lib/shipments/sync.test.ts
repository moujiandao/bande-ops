import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { canonicalShipmentSales, nextEvidenceRange, syncShipmentEvidence, type ShipmentSyncDeps } from './sync';
import { parseShipmentSales } from './evidence';
import type { EvidenceBatch, EvidenceStore } from './store';

const fixture = (name: string) => readFileSync(new URL(`../amazon/__fixtures__/${name}`, import.meta.url), 'utf8');
const captured = JSON.parse(fixture('giveaway-launch-ledger.json'));
const now = new Date('2026-03-20T18:00:00Z');
function batch(patch: Partial<EvidenceBatch> = {}): EvidenceBatch {
  return { id: 'batch', marketplace_id: 'ATVPDKIKX0DER', lane: 'recent', start_date: '2026-03-10', end_date: '2026-03-18',
    classification_version: 1, status: 'pending', sales_report_id: 'sales', promotions_report_id: 'promotions',
    created_at: now.toISOString(), completed_at: null, issue: null, ...patch };
}
function setup(existing = batch()) {
  const ledger = captured.rows.map((r: object) => ({ ...r, sku: captured.item.sku, fn_sku: null }));
  // Include other captured SKUs in the mapping universe without inventing
  // external report rows; only the launch ledger days are asserted below.
  const otherSkus = [...new Set(parseShipmentSales(fixture('giveaway-launch-sales.tsv')).map(s => s.sku))]
    .filter(s => s !== captured.item.sku);
  const store: EvidenceStore = {
    claim: vi.fn().mockResolvedValue(true), release: vi.fn().mockResolvedValue(undefined),
    batches: vi.fn(async lane => lane === 'recent' ? [existing] : [batch({ lane: 'backfill', status: 'complete', start_date: '2025-01-01' })]),
    create: vi.fn(async input => batch(input)), update: vi.fn().mockResolvedValue(undefined),
    ledger: vi.fn().mockResolvedValue([...ledger, ...otherSkus.map(sku => ({ ...ledger[0], sku }))]),
    publish: vi.fn().mockResolvedValue(undefined),
  };
  const client = {
    createShipmentEvidenceReport: vi.fn().mockResolvedValue('new-report'),
    getReportStatus: vi.fn(async ({ reportId }: { reportId: string }) => ({ reportId, processingStatus: 'DONE' as const, reportDocumentId: reportId })),
    downloadReportDocument: vi.fn(async ({ reportDocumentId }: { reportDocumentId: string }) => fixture(`giveaway-launch-${reportDocumentId}.tsv`)),
  };
  const deps: ShipmentSyncDeps = { store, client, now, admin: {} as ShipmentSyncDeps['admin'] };
  return { store, client, deps };
}

describe('resumable shipment sync', () => {
  it('publishes reconciled real launch evidence without retaining order identifiers', async () => {
    const { deps, store } = setup();
    expect((await syncShipmentEvidence(deps)).status).toBe('complete');
    const rows = vi.mocked(store.publish).mock.calls[0][2];
    expect(rows.filter(r => r.sku === captured.item.sku).reduce((n, r) => n + r.excluded_units!, 0)).toBe(28);
    expect(JSON.stringify(rows)).not.toMatch(/orderId|sample-|ship-city/);
    expect(store.release).toHaveBeenCalledOnce();
  });
  it('waits across calls without downloading incomplete reports or publishing zeros', async () => {
    const { deps, store, client } = setup();
    client.getReportStatus.mockResolvedValue({ reportId: 'sales', processingStatus: 'IN_PROGRESS', reportDocumentId: 'sales' } as never);
    expect((await syncShipmentEvidence(deps)).status).toBe('pending');
    expect(store.publish).not.toHaveBeenCalled();
    expect(client.downloadReportDocument).not.toHaveBeenCalled();
    expect(client.createShipmentEvidenceReport).not.toHaveBeenCalled();
  });
  it('preserves completed data on failed reports and releases the lease', async () => {
    const { deps, store, client } = setup();
    client.downloadReportDocument.mockRejectedValue(new Error('private remote payload'));
    const result = await syncShipmentEvidence(deps);
    expect(result.status).toBe('failed');
    expect(result.issue).not.toContain('private');
    expect(store.publish).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith('batch', expect.objectContaining({ status: 'failed' }));
    expect(store.release).toHaveBeenCalledOnce();
  });
  it('resumes a saved first report instead of duplicating it', async () => {
    const { deps, store, client } = setup(batch({ promotions_report_id: null }));
    client.getReportStatus.mockResolvedValue({ reportId: 'sales', processingStatus: 'IN_PROGRESS', reportDocumentId: 'sales' } as never);
    await syncShipmentEvidence(deps);
    expect(client.createShipmentEvidenceReport).toHaveBeenCalledOnce();
    expect(client.createShipmentEvidenceReport).toHaveBeenCalledWith(expect.objectContaining({ kind: 'promotions' }));
    expect(store.update).toHaveBeenCalledWith('batch', { promotions_report_id: 'new-report' });
  });
  it('does no work when another sync holds the marketplace lease', async () => {
    const { deps, store, client } = setup();
    vi.mocked(store.claim).mockResolvedValue(false);
    expect((await syncShipmentEvidence(deps)).status).toBe('busy');
    expect(client.getReportStatus).not.toHaveBeenCalled();
    expect(store.release).not.toHaveBeenCalled();
  });
  it('does not publish empty reports as valid zero coverage', async () => {
    const { deps, store, client } = setup();
    client.downloadReportDocument.mockResolvedValue(fixture('giveaway-launch-sales.tsv').split('\n')[0]);
    expect((await syncShipmentEvidence(deps)).status).toBe('failed');
    expect(store.publish).not.toHaveBeenCalled();
  });
});

describe('date coverage and identity', () => {
  it('revisits seven recent dates and backfills bounded history without starving recent work', () => {
    expect(nextEvidenceRange('recent', [], now)).toEqual({ start_date: '2026-03-12', end_date: '2026-03-18' });
    expect(nextEvidenceRange('backfill', [], now)).toEqual({ start_date: '2026-02-19', end_date: '2026-03-11' });
    expect(nextEvidenceRange('backfill', [batch({ start_date: '2025-01-01' })], now)).toBeNull();
  });
  it('retries failed history three times, then leaves a visible gap and advances', () => {
    const failed = batch({ start_date: '2026-03-01', status: 'failed' });
    expect(nextEvidenceRange('backfill', [failed], now)?.start_date).toBe('2026-03-01');
    expect(nextEvidenceRange('backfill', [failed, failed, failed], now)?.end_date).toBe('2026-02-28');
  });
  it('catches up every missed recent date after an outage, including repeated failures', () => {
    const last = batch({ status: 'complete', start_date: '2026-01-01', end_date: '2026-01-07' });
    const first = nextEvidenceRange('recent', [last], now)!;
    expect(first).toEqual({ start_date: '2026-01-01', end_date: '2026-01-21' });
    const failed = batch({ ...first, status: 'failed' });
    expect(nextEvidenceRange('recent', [failed, failed, last], now)).toEqual(first);
    expect(nextEvidenceRange('recent', [batch({ ...first, status: 'complete' })], now))
      .toEqual({ start_date: '2026-01-15', end_date: '2026-02-04' });
    expect(nextEvidenceRange('recent', [failed], now)).toEqual(first);
  });
  it('leaves terminally unavailable recent ranges unknown while collecting future sales', () => {
    const gap = batch({ start_date: '2026-01-01', end_date: '2026-01-21', status: 'failed' });
    const forward = nextEvidenceRange('recent', [gap, gap, gap], now)!;
    expect(forward).toEqual({ start_date: '2026-01-22', end_date: '2026-02-11' });
    const retried = batch({ ...forward, status: 'failed' });
    expect(nextEvidenceRange('recent', [retried, gap, gap], now)).toEqual(forward);
    const currentGap = batch({ start_date: '2026-03-12', end_date: '2026-03-18', status: 'failed' });
    expect(nextEvidenceRange('recent', [currentGap, currentGap, currentGap], now)).toBeNull();
    expect(nextEvidenceRange('recent', [currentGap, currentGap, currentGap], new Date('2026-03-21T18:00:00Z')))
      .toEqual({ start_date: '2026-03-19', end_date: '2026-03-19' });
  });
  it('uses unique FNSKU mappings and refuses conflicting identities', () => {
    const sale = parseShipmentSales(fixture('giveaway-launch-sales.tsv'))[0];
    const row = { sku: 'canonical', fn_sku: sale.fnSku, activity_date: sale.day, customer_shipments: 1, customer_shipments_valid: true };
    expect(canonicalShipmentSales([sale], [row]).sales[0].sku).toBe('canonical');
    expect(canonicalShipmentSales([sale], [row, { ...row, sku: sale.sku }]).unresolvedDays.has(sale.day)).toBe(true);
  });
});
