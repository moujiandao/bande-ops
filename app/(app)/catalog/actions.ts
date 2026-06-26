'use server';

import { revalidatePath } from 'next/cache';
import { getAmazonClient } from '@/lib/amazon';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncCatalog } from '@/lib/catalog/sync';
import { syncInventory } from '@/lib/inventory/sync';
import { requireUser } from '@/lib/auth/guard';

/**
 * Server action that triggers a full Module 1 sync from the /catalog page.
 *
 * One "Sync now" refreshes both synced mirrors: the catalog and inventory
 * levels. Wires the real dependencies — the configured AmazonClient
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
