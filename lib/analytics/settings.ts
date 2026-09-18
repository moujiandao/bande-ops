import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';

export interface AnalyticsSettings {
  /** Null means the saved preference could not be read, not the default. */
  excludeVine: boolean | null;
  error: string | null;
}

export async function readAnalyticsSettings(
  supabase: Pick<SupabaseClient, 'from'>,
  marketplaceId = DEFAULT_MARKETPLACE.id,
): Promise<AnalyticsSettings> {
  try {
    const { data, error } = await supabase
      .from('analytics_settings')
      .select('exclude_vine')
      .eq('marketplace_id', marketplaceId)
      .maybeSingle();
    if (error || (data && typeof data.exclude_vine !== 'boolean')) {
      return { excludeVine: null, error: 'Could not load the saved analytics setting. Check migration 0022 and database access.' };
    }
    return { excludeVine: data?.exclude_vine ?? false, error: null };
  } catch {
    return { excludeVine: null, error: 'Could not load the saved analytics setting. Try again.' };
  }
}

/**
 * Source validation is intentionally a release gate. No Amazon marker or source
 * coverage has been verified yet. Do not substitute ledger totals, zero price,
 * or an empty report for confirmed, reconciled Vine evidence.
 */
export function vineAdjustmentIssue(settings: AnalyticsSettings): string | null {
  if (settings.error) return settings.error;
  if (settings.excludeVine === null) return 'The saved analytics basis is unavailable.';
  return settings.excludeVine
    ? 'Vine adjustment unavailable. Amazon Vine identification and shipment matching have not been verified yet. Adjusted momentum remains unknown.'
    : null;
}

export function analyticsBasisLabel(settings: AnalyticsSettings): string {
  return settings.excludeVine === null
    ? 'Momentum basis unavailable'
    : settings.excludeVine
      ? 'Momentum basis: exclude confirmed Vine'
      : 'Momentum basis: all shipments (including Vine)';
}

export interface SaveAnalyticsState {
  saved: boolean | null;
  error: string | null;
}
