'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/guard';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAdsClient } from '@/lib/ads';
import { syncCampaigns } from '@/lib/ads/sync';
import {
  applyCampaignChange as applyCampaignChangeCore,
  type ApplyCampaignChangeInput,
} from '@/lib/ads/write';

/**
 * Server action for the FIRST write-back to Amazon: pause/enable a campaign or
 * change its daily budget. This is the thin wiring layer; the orchestration +
 * safety ordering (authorize -> log -> write -> resync) lives in the injectable,
 * unit-tested core (`lib/ads/write.ts`).
 *
 * Non-negotiables enforced here:
 *   - OWNER-gated: requireOwner() runs first inside the core (staff cannot write).
 *   - Audited: the core appends an ads_write_log row BEFORE the Amazon write.
 *   - Re-synced: after the write, the campaigns mirror is refreshed so the page
 *     reflects reality.
 * Server Actions are public POST endpoints, so this re-checks authorization
 * itself (the route-group layout gate does not protect actions). It is only ever
 * invoked by an explicit, confirmed user action in the UI — there is no
 * automated/unattended path.
 */
export async function applyCampaignChange(
  input: ApplyCampaignChangeInput,
): Promise<void> {
  const supabase = await createClient();
  const adsClient = getAdsClient();

  await applyCampaignChangeCore(
    {
      requireOwner,
      db: supabase,
      updateCampaign: (update) => adsClient.updateCampaign(update),
      // Re-sync the campaigns mirror (carries state + daily budget). Metrics are
      // unaffected by a state/budget write, so we don't re-pull them.
      resync: async () => {
        const admin = createAdminClient();
        await syncCampaigns({ client: adsClient, admin });
      },
    },
    input,
  );

  revalidatePath('/ads');
}
