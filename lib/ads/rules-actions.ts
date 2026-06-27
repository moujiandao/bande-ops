'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_MARKETPLACE } from './types';

/**
 * Server action for the /ads ACOS-target editor.
 *
 * Persists OUR operational layer (the per-marketplace ACOS target) — an
 * authoritative, user-authored row, NOT a synced mirror. RLS already grants
 * authenticated SELECT/INSERT/UPDATE on ads_rules, so this runs on the ordinary
 * authenticated server client (no service role).
 *
 * Unit boundary: the operator types a PERCENT (e.g. 25); we store a RATIO (0.25)
 * so the value is directly comparable to acos() output. The percent<->ratio
 * conversion lives only at this edge (write) and on the page (display).
 *
 * One target row per marketplace, so we resolve any existing row first and
 * UPDATE it, otherwise INSERT. Server Actions are public endpoints — re-check
 * auth via requireUser().
 */

/** Parse a percent form field into a positive ratio, or throw a clear error. */
function parsePercentToRatio(value: FormDataEntryValue | null): number {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent <= 0) {
    throw new Error('ACOS target must be a positive percentage.');
  }
  return percent / 100;
}

/** Set or update the ACOS target (entered as a percent) for the US marketplace. */
export async function updateAcosTargetAction(formData: FormData): Promise<void> {
  await requireUser();

  const acosTarget = parsePercentToRatio(formData.get('acosTargetPercent'));
  const marketplaceId = DEFAULT_MARKETPLACE.id;

  const supabase = await createClient();

  // Single upsert on the unique (marketplace_id) row, not select-then-write:
  // avoids a TOCTOU race where two concurrent first-writes both see no row,
  // both INSERT, and the second trips the unique constraint.
  const { error } = await supabase.from('ads_rules').upsert(
    {
      marketplace_id: marketplaceId,
      acos_target: acosTarget,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'marketplace_id' },
  );
  if (error) throw new Error(`Could not save ACOS target: ${error.message}`);

  revalidatePath('/ads');
}
