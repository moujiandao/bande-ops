'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Server actions for the replenishment settings page.
 *
 * These persist OUR operational layer (lead time + safety stock) — authoritative
 * rows the user authors directly, not a synced mirror. There are two write
 * paths: the single global default (the row where `sku IS NULL`) and per-SKU
 * overrides.
 *
 * Why a manual select-then-write instead of `.upsert()`: the table's uniqueness
 * is an expression index on `(marketplace_id, coalesce(sku, ''))` so a single
 * NULL-sku default can't be duplicated. PostgREST's `onConflict` can't target an
 * expression index, so we resolve the existing row ourselves and INSERT or
 * UPDATE accordingly. RLS already grants authenticated SELECT/INSERT/UPDATE, so
 * these run on the ordinary authenticated server client (no service role).
 *
 * Server Actions are public endpoints — each re-checks auth via requireUser().
 */

const DEFAULT_MARKETPLACE_ID = 'ATVPDKIKX0DER';

/** Parse a form field into a non-negative integer, or throw a clear error. */
function parseNonNegativeInt(value: FormDataEntryValue | null, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${field} must be a non-negative whole number.`);
  }
  return n;
}

/**
 * Upsert a single settings row, keyed by (marketplace_id, sku) where a NULL sku
 * is the global default. Resolves any existing row first, then UPDATEs it or
 * INSERTs a new one.
 */
async function writeSetting(params: {
  sku: string | null;
  leadTimeDays: number;
  safetyStock: number;
}): Promise<void> {
  const supabase = await createClient();
  const marketplaceId = DEFAULT_MARKETPLACE_ID;

  // NULL sku needs `.is('sku', null)`; a concrete sku uses `.eq`.
  const lookup = supabase
    .from('replenishment_settings')
    .select('id')
    .eq('marketplace_id', marketplaceId);
  const existingRes = await (params.sku === null
    ? lookup.is('sku', null)
    : lookup.eq('sku', params.sku)
  ).maybeSingle();

  if (existingRes.error) {
    throw new Error(`Could not load existing setting: ${existingRes.error.message}`);
  }

  const values = {
    lead_time_days: params.leadTimeDays,
    safety_stock: params.safetyStock,
    updated_at: new Date().toISOString(),
  };

  if (existingRes.data) {
    const { error } = await supabase
      .from('replenishment_settings')
      .update(values)
      .eq('id', existingRes.data.id);
    if (error) throw new Error(`Could not update setting: ${error.message}`);
  } else {
    const { error } = await supabase.from('replenishment_settings').insert({
      marketplace_id: marketplaceId,
      sku: params.sku,
      ...values,
    });
    if (error) throw new Error(`Could not create setting: ${error.message}`);
  }

  revalidatePath('/settings');
}

/** Save the global default (lead time + safety stock) for all SKUs. */
export async function saveDefaultsAction(formData: FormData): Promise<void> {
  await requireUser();

  await writeSetting({
    sku: null,
    leadTimeDays: parseNonNegativeInt(formData.get('leadTimeDays'), 'Lead time'),
    safetyStock: parseNonNegativeInt(formData.get('safetyStock'), 'Safety stock'),
  });
}

/** Set or edit a per-SKU override. */
export async function saveSkuOverrideAction(formData: FormData): Promise<void> {
  await requireUser();

  const sku = String(formData.get('sku') ?? '').trim();
  if (!sku) {
    throw new Error('A SKU is required to set a per-SKU override.');
  }

  await writeSetting({
    sku,
    leadTimeDays: parseNonNegativeInt(formData.get('leadTimeDays'), 'Lead time'),
    safetyStock: parseNonNegativeInt(formData.get('safetyStock'), 'Safety stock'),
  });
}
