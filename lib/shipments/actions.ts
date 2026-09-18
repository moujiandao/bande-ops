'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAmazonClient } from '@/lib/amazon';
import { syncShipmentEvidence } from './sync';

export async function refreshShipmentEvidenceAction(): Promise<{ message: string; error: string | null }> {
  await requireUser();
  try {
    const result = await syncShipmentEvidence({ client: getAmazonClient(), admin: createAdminClient() });
    for (const path of ['/settings', '/analytics', '/reorder', '/replenishment']) revalidatePath(path);
    return {
      message: result.status === 'busy' ? 'A shipment evidence refresh is already running.'
        : `${result.publishedDays} daily results refreshed.${result.status === 'pending' ? ' Amazon is preparing reports. Refresh again later to collect them, or let the daily sync continue.' : ''}`,
      error: result.issue,
    };
  } catch {
    return { message: '', error: 'Could not refresh shipment evidence. Check migration 0023 and database access.' };
  }
}
