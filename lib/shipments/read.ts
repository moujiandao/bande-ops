import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';
import { marketplaceDay, shiftDay, SHIPMENT_CLASSIFICATION_VERSION, type DailyShipmentAdjustment } from './evidence';
import type { EvidenceBatch } from './store';

export type AdjustmentRow = DailyShipmentAdjustment & {
  marketplace_id: string;
  classification_version: number;
};

export interface ShipmentEvidenceStatus {
  currentIssue: string | null;
  throughDate: string | null;
  lastCompletedAt: string | null;
  pending: boolean;
}

const unavailable: ShipmentEvidenceStatus = {
  currentIssue: 'Giveaway evidence unavailable. Apply migration 0023 and run the sync.',
  throughDate: null, lastCompletedAt: null, pending: false,
};

export async function readShipmentEvidenceStatus(
  supabase: Pick<SupabaseClient, 'from'>,
  now = new Date(),
): Promise<ShipmentEvidenceStatus> {
  try {
    const { data, error } = await supabase.from('shipment_evidence_batches')
      .select('status, end_date, classification_version, completed_at, created_at')
      .eq('marketplace_id', DEFAULT_MARKETPLACE.id).eq('lane', 'recent')
      .order('created_at', { ascending: false }).limit(20);
    if (error) return unavailable;
    const batches = (data ?? []) as EvidenceBatch[];
    const latest = batches[0];
    const complete = batches.find(b => b.status === 'complete' && b.classification_version === SHIPMENT_CLASSIFICATION_VERSION);
    const completedMs = Date.parse(complete?.completed_at ?? '');
    const currentIssue = !complete ? 'Giveaway evidence is being prepared. Adjusted days remain unknown until reports reconcile.'
      : latest?.status === 'failed' ? 'The latest giveaway evidence refresh failed. Only dated historical evidence is available.'
        : complete.end_date < shiftDay(marketplaceDay(now), -3) ? 'Giveaway reports are catching up. Current adjusted momentum is unavailable until recent dates reconcile.'
        : !Number.isFinite(completedMs) || now.getTime() - completedMs > 48 * 60 * 60 * 1000
          ? 'Giveaway evidence has not refreshed in 48 hours. Current adjusted momentum is unavailable.' : null;
    return { currentIssue, throughDate: complete?.end_date ?? null,
      lastCompletedAt: complete?.completed_at ?? null, pending: latest?.status === 'pending' };
  } catch { return unavailable; }
}

export async function readShipmentAdjustments(input: {
  supabase: Pick<SupabaseClient, 'from'>;
  startDate: string | null;
  endDate: string | null;
  now?: Date;
}): Promise<ShipmentEvidenceStatus & { rows: AdjustmentRow[] }> {
  const status = await readShipmentEvidenceStatus(input.supabase, input.now);
  const rows: AdjustmentRow[] = [];
  if (!input.startDate || !input.endDate) return { ...status, rows };
  try {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await input.supabase.from('current_shipment_adjustments')
        .select('marketplace_id, sku, activity_date, ledger_units, shipment_units, excluded_units, vine_units, status, issue, classification_version')
        .eq('marketplace_id', DEFAULT_MARKETPLACE.id).gte('activity_date', input.startDate).lte('activity_date', input.endDate)
        .order('activity_date').order('sku').range(offset, offset + 999);
      if (error) return { ...unavailable, rows: [] };
      rows.push(...(data ?? []) as AdjustmentRow[]);
      if ((data?.length ?? 0) < 1000) return { ...status, rows };
    }
  } catch { return { ...unavailable, rows: [] }; }
}

/** A later ledger correction invalidates old adjustment evidence immediately. */
export function reconciledExcludedUnits(
  ledger: { marketplace_id: string; customer_shipments: number },
  adjustment: AdjustmentRow | undefined,
): number | null {
  if (!adjustment || adjustment.classification_version !== SHIPMENT_CLASSIFICATION_VERSION ||
    adjustment.marketplace_id !== ledger.marketplace_id || adjustment.status !== 'complete' ||
    adjustment.ledger_units !== ledger.customer_shipments || adjustment.shipment_units !== ledger.customer_shipments ||
    adjustment.excluded_units === null || !Number.isSafeInteger(adjustment.excluded_units) ||
    adjustment.excluded_units < 0 || adjustment.excluded_units > ledger.customer_shipments) return null;
  return adjustment.excluded_units;
}
