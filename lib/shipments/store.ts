import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncWriter } from '@/lib/sync/run';
import type { DailyShipmentAdjustment, LedgerShipmentDay } from './evidence';

export interface EvidenceBatch {
  id: string;
  marketplace_id: string;
  lane: 'recent' | 'backfill';
  start_date: string;
  end_date: string;
  classification_version: number;
  status: 'pending' | 'complete' | 'failed';
  sales_report_id: string | null;
  promotions_report_id: string | null;
  created_at: string;
  completed_at: string | null;
  issue: string | null;
}

export interface EvidenceStore {
  claim(token: string): Promise<boolean>;
  release(token: string): Promise<void>;
  batches(lane: EvidenceBatch['lane']): Promise<EvidenceBatch[]>;
  create(input: Pick<EvidenceBatch, 'lane' | 'start_date' | 'end_date' | 'classification_version'>): Promise<EvidenceBatch>;
  update(id: string, patch: Partial<EvidenceBatch>): Promise<void>;
  ledger(start: string, end: string): Promise<Array<LedgerShipmentDay & { fn_sku: string | null }>>;
  publish(id: string, token: string, rows: DailyShipmentAdjustment[]): Promise<void>;
}

/** Keep the shared SyncWriter contract small. Read/RPC needs stay local here. */
export function createEvidenceStore(admin: SyncWriter, marketplaceId: string): EvidenceStore {
  const db = admin as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;
  let leaseToken: string | null = null;
  const check = (error: { message: string } | null) => {
    if (error) throw new Error('Shipment evidence database operation failed. Check migration 0023 and database access.');
  };
  return {
    async claim(token) {
      const { data, error } = await db.rpc('claim_shipment_sync', { p_marketplace: marketplaceId, p_token: token });
      check(error); leaseToken = data === true ? token : null; return data === true;
    },
    async release(token) {
      const { error } = await db.rpc('release_shipment_sync', { p_marketplace: marketplaceId, p_token: token });
      check(error);
    },
    async batches(lane) {
      const { data, error } = await db.from('shipment_evidence_batches').select('*')
        .eq('marketplace_id', marketplaceId).eq('lane', lane).order('created_at', { ascending: false }).limit(3);
      check(error);
      const batches = data as EvidenceBatch[];
      if (lane === 'recent' && !batches.some(b => b.status === 'complete')) {
        const completed = await db.from('shipment_evidence_batches').select('*')
          .eq('marketplace_id', marketplaceId).eq('lane', lane).eq('status', 'complete')
          .order('created_at', { ascending: false }).limit(1);
        check(completed.error);
        batches.push(...(completed.data ?? []) as EvidenceBatch[]);
      }
      return batches;
    },
    async create(input) {
      const { data, error } = await db.from('shipment_evidence_batches')
        .insert({ ...input, marketplace_id: marketplaceId }).select('*').single();
      check(error); return data as EvidenceBatch;
    },
    async update(id, patch) {
      const { error } = await db.rpc('update_shipment_evidence', { p_batch: id, p_token: leaseToken, p_patch: patch });
      check(error);
    },
    async ledger(start, end) {
      const rows: Array<LedgerShipmentDay & { fn_sku: string | null }> = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.from('fba_daily_velocity_inputs')
          .select('sku, fn_sku, activity_date, customer_shipments, customer_shipments_valid')
          .eq('marketplace_id', marketplaceId).gte('activity_date', start).lte('activity_date', end)
          .order('activity_date').order('sku').range(offset, offset + 999);
        check(error); rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) return rows;
      }
    },
    async publish(id, token, rows) {
      const { error } = await db.rpc('publish_shipment_evidence', { p_batch: id, p_token: token, p_rows: rows });
      check(error);
    },
  };
}
