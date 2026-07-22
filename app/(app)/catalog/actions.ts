'use server';

import { revalidatePath } from 'next/cache';
import { getAmazonClient } from '@/lib/amazon';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncCatalog } from '@/lib/catalog/sync';
import { syncInventory } from '@/lib/inventory/sync';
import { requireUser } from '@/lib/auth/guard';

/**
 * Server action that triggers the catalog sync from the /catalog page.
 *
 * One "Sync now" refreshes exactly two synced mirrors: the catalog and FBA
 * inventory levels. It deliberately does NOT refresh the other reorder
 * sources — AWD inventory and FBA ledger velocity refresh on the scheduled
 * cron (`runFullSync`), and SVD inventory refreshes only from the owner-gated
 * button on /reorder. Wires the real dependencies — the configured AmazonClient
 * (FakeAmazonClient when AMAZON_USE_FAKE=true) and the service-role admin
 * client — into the injectable `syncCatalog` and `syncInventory`
 * orchestrations, then revalidates the page so the freshly-mirrored rows
 * render. The two clients are reused across both syncs; both deps are
 * server-only and this file runs only on the server ('use server').
 */
export async function syncCatalogAction(): Promise<void> {
  // Server Actions are public endpoints — re-check auth independently of the
  // route-group layout gate.
  await requireUser();

  const client = getAmazonClient();
  const admin = createAdminClient();

  await syncCatalog({ client, admin });
  await syncInventory({ client, admin });

  revalidatePath('/catalog');
}
