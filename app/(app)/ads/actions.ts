'use server';

import { revalidatePath } from 'next/cache';
import { getAdsClient } from '@/lib/ads';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncCampaigns, syncCampaignMetrics } from '@/lib/ads/sync';
import { requireUser } from '@/lib/auth/guard';

/**
 * Server action that triggers an Ads campaign sync from the /ads page.
 *
 * "Sync now" refreshes both the ads_campaigns mirror AND the
 * ads_campaign_metrics mirror. Wires the real dependencies — the configured
 * AdsClient (FakeAdsClient when AMAZON_USE_FAKE=true) and the service-role admin
 * client — into the injectable sync orchestrations, then revalidates the page so
 * the freshly mirrored rows render. Both deps are server-only and this file runs
 * only on the server ('use server').
 */
export async function syncAdsAction(): Promise<void> {
  // Server Actions are public endpoints — re-check auth independently of the
  // route-group layout gate.
  await requireUser();

  const client = getAdsClient();
  const admin = createAdminClient();

  // Campaigns first (the list), then metrics (joined to it by natural key).
  await syncCampaigns({ client, admin });
  await syncCampaignMetrics({ client, admin });

  revalidatePath('/ads');
}
