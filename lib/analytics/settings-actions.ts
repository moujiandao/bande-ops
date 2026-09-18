'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';
import { createClient } from '@/lib/supabase/server';
import type { SaveAnalyticsState } from './settings';

export async function saveAnalyticsSettingsAction(
  previous: SaveAnalyticsState,
  formData: FormData,
): Promise<SaveAnalyticsState> {
  await requireUser();
  const value = formData.get('excludeVine');
  if (value !== 'true' && value !== 'false') {
    return { saved: previous.saved, error: 'Choose whether to exclude Vine before saving.' };
  }
  const excludeVine = value === 'true';
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('analytics_settings').upsert({
      marketplace_id: DEFAULT_MARKETPLACE.id,
      exclude_vine: excludeVine,
    }, { onConflict: 'marketplace_id' }).select('exclude_vine').single();
    if (error || data?.exclude_vine !== excludeVine) {
      return { saved: previous.saved, error: 'Could not save the analytics setting. Check database access and try again.' };
    }
  } catch {
    return { saved: previous.saved, error: 'Could not save the analytics setting. Try again.' };
  }
  for (const path of ['/settings', '/analytics', '/reorder', '/replenishment']) {
    revalidatePath(path);
  }
  return { saved: excludeVine, error: null };
}
