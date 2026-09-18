import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';
import type { ShipmentEvidenceStatus } from '@/lib/shipments/read';

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

export function vineAdjustmentIssue(settings: AnalyticsSettings, evidence?: ShipmentEvidenceStatus): string | null {
  if (settings.error) return settings.error;
  if (settings.excludeVine === null) return 'The saved analytics basis is unavailable.';
  return settings.excludeVine
    ? evidence?.currentIssue ?? (evidence ? null : 'Giveaway evidence unavailable. Adjusted momentum requires reconciled shipment reports.')
    : null;
}

export function analyticsBasisLabel(settings: AnalyticsSettings): string {
  return settings.excludeVine === null
    ? 'Momentum basis unavailable'
    : settings.excludeVine
      ? 'Momentum basis: excluding Vine and full-discount giveaways'
      : 'Momentum basis: all shipments (including giveaways)';
}

export interface SaveAnalyticsState {
  saved: boolean | null;
  error: string | null;
}
