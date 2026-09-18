import { randomUUID } from 'node:crypto';
import type { AmazonClient } from '@/lib/amazon/client';
import { DEFAULT_MARKETPLACE, type Marketplace } from '@/lib/amazon/types';
import type { SyncWriter } from '@/lib/sync/run';
import {
  marketplaceDay, shiftDay, parseShipmentSales, parseShipmentPromotions,
  reconcileShipmentDays, SHIPMENT_CLASSIFICATION_VERSION,
  type ShipmentSale, type LedgerShipmentDay,
} from './evidence';
import { createEvidenceStore, type EvidenceBatch, type EvidenceStore } from './store';

export interface ShipmentSyncDeps {
  client: Pick<AmazonClient, 'createShipmentEvidenceReport' | 'getReportStatus' | 'downloadReportDocument'>;
  admin: SyncWriter;
  marketplace?: Marketplace;
  now?: Date;
  store?: EvidenceStore;
}

export interface ShipmentSyncResult {
  status: 'pending' | 'complete' | 'busy' | 'failed';
  publishedDays: number;
  issue: string | null;
}

/** Match FNSKU first. Never prefix-guess a shipment into a ledger SKU. */
export function canonicalShipmentSales(sales: ShipmentSale[], ledger: Array<LedgerShipmentDay & { fn_sku: string | null }>) {
  const byFnSku = new Map<string, Set<string>>();
  const skus = new Set(ledger.map(r => r.sku));
  for (const row of ledger) {
    if (!row.fn_sku) continue;
    const matches = byFnSku.get(row.fn_sku) ?? new Set<string>();
    matches.add(row.sku); byFnSku.set(row.fn_sku, matches);
  }
  const unresolvedDays = new Set<string>();
  const normalized = sales.map(s => {
    const matches = byFnSku.get(s.fnSku);
    if (matches?.size === 1) {
      const sku = [...matches][0];
      if (skus.has(s.sku) && sku !== s.sku) unresolvedDays.add(s.day);
      return { ...s, sku };
    }
    if ((matches && matches.size > 1) || !skus.has(s.sku)) unresolvedDays.add(s.day);
    return s;
  });
  return { sales: normalized, unresolvedDays };
}

export function nextEvidenceRange(lane: EvidenceBatch['lane'], batches: EvidenceBatch[], now: Date) {
  const completedThrough = shiftDay(marketplaceDay(now), -2);
  const latest = batches[0];
  if (lane === 'recent') {
    if (latest?.status === 'failed') {
      const failures = batches.filter(b => b.status === 'failed' && b.start_date === latest.start_date && b.end_date === latest.end_date).length;
      if (failures < 3) return { start_date: latest.start_date, end_date: latest.end_date };
      // Retention limits or an empty interval must not trap all future sales
      // behind an unrecoverable catch-up job. Keep the failed range as a gap.
      const start = shiftDay(latest.end_date, 1);
      if (start > completedThrough) return null;
      return { start_date: start, end_date: [completedThrough, shiftDay(start, 20)].sort()[0] };
    }
    const lastComplete = batches.find(b => b.status === 'complete');
    const normalStart = shiftDay(completedThrough, -6);
    const resumeStart = lastComplete ? shiftDay(lastComplete.end_date, -6) : latest?.start_date ?? normalStart;
    const start = [normalStart, resumeStart].sort()[0];
    // Catch up forward after outages rather than permanently skipping the gap.
    return { start_date: start, end_date: [completedThrough, shiftDay(start, 20)].sort()[0] };
  }
  // A failed historical interval gets up to three attempts, then remains an
  // explicit gap while older intervals continue. Never turn the gap into zero.
  if (latest?.status === 'failed' && batches.filter(b => b.start_date === latest.start_date && b.status === 'failed').length < 3) {
    return { start_date: latest.start_date, end_date: latest.end_date };
  }
  const end = latest ? shiftDay(latest.start_date, -1) : shiftDay(completedThrough, -7);
  const floor = shiftDay(marketplaceDay(now), -365);
  if (end < floor) return null;
  return { start_date: [shiftDay(end, -20), floor].sort().at(-1)!, end_date: end };
}

/**
 * Advance two persisted report jobs once per call. No polling sleep, page-load
 * fetch, or raw report storage. Recent overlap keeps future shipments current;
 * a separate bounded lane walks history without starving recent work.
 */
export async function syncShipmentEvidence(deps: ShipmentSyncDeps): Promise<ShipmentSyncResult> {
  const marketplace = deps.marketplace ?? DEFAULT_MARKETPLACE;
  if (marketplace.id !== DEFAULT_MARKETPLACE.id) return { status: 'failed', publishedDays: 0, issue: 'Shipment evidence currently supports the US marketplace only.' };
  const now = deps.now ?? new Date();
  const store = deps.store ?? createEvidenceStore(deps.admin, marketplace.id);
  const token = randomUUID();
  if (!await store.claim(token)) return { status: 'busy', publishedDays: 0, issue: null };
  let publishedDays = 0;
  let pending = false;
  let issue: string | null = null;
  async function requestReports(batch: EvidenceBatch) {
    // Padding protects Pacific midnight and adjacent partial shipments.
    const dataStartTime = `${shiftDay(batch.start_date, -2)}T00:00:00Z`;
    const dataEndTime = `${shiftDay(batch.end_date, 3)}T00:00:00Z`;
    for (const kind of ['sales', 'promotions'] as const) {
      const key = kind === 'sales' ? 'sales_report_id' : 'promotions_report_id';
      if (!batch[key]) {
        const id = await deps.client.createShipmentEvidenceReport({ marketplace, kind, dataStartTime, dataEndTime });
        await store.update(batch.id, { [key]: id });
        batch[key] = id;
      }
    }
  }
  try {
    for (const lane of ['recent', 'backfill'] as const) {
      let batch: EvidenceBatch | undefined;
      try {
        const batches = await store.batches(lane);
        batch = batches.find(b => b.status === 'pending');
        if (!batch) {
          const range = nextEvidenceRange(lane, batches, now);
          if (!range) {
            if (lane === 'recent' && batches[0]?.status === 'failed') issue = 'Recent shipment reports remain unavailable. The failed range is retained as an evidence gap; the next new interval will be checked by the daily sync.';
            continue;
          }
          // Avoid duplicate completed same-day recent jobs from repeated clicks.
          if (lane === 'recent' && batches[0]?.status === 'complete' && batches[0].end_date === range.end_date && batches[0].classification_version === SHIPMENT_CLASSIFICATION_VERSION) continue;
          batch = await store.create({ ...range, lane, classification_version: SHIPMENT_CLASSIFICATION_VERSION });
        }
        if (batch.classification_version !== SHIPMENT_CLASSIFICATION_VERSION || now.getTime() - Date.parse(batch.created_at) > 3 * 86_400_000) {
          throw new Error('Report job expired or classification changed.');
        }
        await requestReports(batch);
        const statuses = await Promise.all([batch.sales_report_id!, batch.promotions_report_id!]
          .map(reportId => deps.client.getReportStatus({ marketplace, reportId })));
        if (statuses.some(s => s.processingStatus === 'FATAL' || s.processingStatus === 'CANCELLED')) throw new Error('Amazon report unavailable.');
        if (statuses.some(s => s.processingStatus !== 'DONE')) { pending = true; continue; }
        if (statuses.some(s => !s.reportDocumentId)) throw new Error('Missing report document.');
        // Normalize immediately. Only allowlisted values survive the parser.
        const sales = parseShipmentSales(await deps.client.downloadReportDocument({ marketplace, reportDocumentId: statuses[0].reportDocumentId! }));
        const promotions = parseShipmentPromotions(await deps.client.downloadReportDocument({ marketplace, reportDocumentId: statuses[1].reportDocumentId! }));
        const ledger = await store.ledger(batch.start_date, batch.end_date);
        if (!ledger.length) throw new Error('No ledger rows to reconcile.');
        // Only published dates need canonical mapping; the padded rows still
        // participate in order cardinality checks across date boundaries.
        const canonical = canonicalShipmentSales(sales, ledger);
        const days = reconcileShipmentDays({ sales: canonical.sales, promotions, ledger, startDate: batch.start_date, endDate: batch.end_date })
          .map(d => canonical.unresolvedDays.has(d.activity_date)
            ? { ...d, status: 'unknown' as const, excluded_units: null, issue: 'unresolved-sku-mapping' } : d);
        await store.publish(batch.id, token, days);
        publishedDays += days.length;
        // Queue the next interval immediately so the next daily run can
        // collect it instead of spending every other run only requesting it.
        const next = nextEvidenceRange(lane, [{ ...batch, status: 'complete' }, ...batches], now);
        const publishedEnd = batch.end_date;
        batch = undefined; // Never mark an already published generation failed.
        if (next && (lane === 'backfill' || next.end_date > publishedEnd)) {
          batch = await store.create({ ...next, lane, classification_version: SHIPMENT_CLASSIFICATION_VERSION });
          await requestReports(batch);
          pending = true;
        }
      } catch {
        // Never include Amazon payloads, order identifiers, or signed URLs in
        // errors. A persisted safe summary makes failure visible to readers.
        issue = 'Shipment evidence could not be reconciled. Check report access, source format, and migration 0023; the next sync retries.';
        if (batch) await store.update(batch.id, { status: 'failed', issue });
      }
    }
    return { status: issue ? 'failed' : pending ? 'pending' : 'complete', publishedDays, issue };
  } finally {
    await store.release(token);
  }
}
