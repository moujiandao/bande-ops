'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { validatePolicyInput } from './policy';

/**
 * Server actions for the replenishment settings page.
 *
 * These persist OUR operational layer (lead time + safety stock), authoritative
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
 * Server Actions are public endpoints. Each re-checks auth via requireUser().
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

function parsePositiveInt(value: FormDataEntryValue | null, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${field} must be a positive whole number.`);
  }
  return n;
}

function checkbox(formData: FormData, field: string): boolean {
  return formData.get(field) === 'on';
}

/**
 * Parse the coverage target, entered in MONTHS in the UI, into stored DAYS
 * (× 30). Required on the global default; optional on a per-SKU override where a
 * blank field means "fall back to the default" and is stored as NULL.
 */
function parseCoverageMonthsToDays(
  value: FormDataEntryValue | null,
  opts: { required: boolean },
): number | null {
  const raw = String(value ?? '').trim();
  if (raw === '') {
    if (opts.required) {
      throw new Error('Coverage (months) is required.');
    }
    return null;
  }
  const months = Number(raw);
  if (!Number.isFinite(months) || months <= 0) {
    throw new Error('Coverage (months) must be a positive number.');
  }
  return Math.round(months * 30);
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
  /** Coverage target in days, or null to leave unset (per-SKU falls back to default). */
  coverageDays: number | null;
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
    target_coverage_days: params.coverageDays,
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
  revalidatePath('/reorder');
}

/** Save the global default (lead time + safety stock) for all SKUs. */
export async function saveDefaultsAction(formData: FormData): Promise<void> {
  await requireUser();

  await writeSetting({
    sku: null,
    leadTimeDays: parseNonNegativeInt(formData.get('leadTimeDays'), 'Lead time'),
    safetyStock: parseNonNegativeInt(formData.get('safetyStock'), 'Safety stock'),
    // The global default coverage is required — it's the fallback every SKU uses.
    coverageDays: parseCoverageMonthsToDays(formData.get('coverageMonths'), { required: true }),
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
    // Per-SKU coverage is optional — blank falls back to the global default.
    coverageDays: parseCoverageMonthsToDays(formData.get('coverageMonths'), { required: false }),
  });
}

/** Save the global replenishment policy that controls velocity and supply rules. */
export async function savePolicyAction(formData: FormData): Promise<void> {
  await requireUser();

  const policy = validatePolicyInput({
    velocitySampleInStockDays: parsePositiveInt(
      formData.get('velocitySampleInStockDays'),
      'Velocity sample days',
    ),
    velocityMaxLookbackDays: parsePositiveInt(
      formData.get('velocityMaxLookbackDays'),
      'Velocity max lookback days',
    ),
    countInboundWorking: checkbox(formData, 'countInboundWorking'),
    countInboundShipped: checkbox(formData, 'countInboundShipped'),
    countInboundReceiving: checkbox(formData, 'countInboundReceiving'),
  });

  const supabase = await createClient();
  const { error } = await supabase.from('replenishment_policy').upsert(
    {
      marketplace_id: DEFAULT_MARKETPLACE_ID,
      velocity_sample_in_stock_days: policy.velocitySampleInStockDays,
      velocity_max_lookback_days: policy.velocityMaxLookbackDays,
      fulfillment_mode: policy.fulfillmentMode,
      svd_mode: policy.svdMode,
      unknown_stock_mode: policy.unknownStockMode,
      stale_source_mode: policy.staleSourceMode,
      count_inbound_working: policy.countInboundWorking,
      count_inbound_shipped: policy.countInboundShipped,
      count_inbound_receiving: policy.countInboundReceiving,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'marketplace_id' },
  );
  if (error) throw new Error(`Could not save replenishment policy: ${error.message}`);

  revalidatePath('/settings');
  revalidatePath('/reorder');
}
