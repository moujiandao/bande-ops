'use server';

import { revalidatePath } from 'next/cache';
import { getAmazonClient } from '@/lib/amazon';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncCatalog } from '@/lib/catalog/sync';
import { requireUser } from '@/lib/auth/guard';

/**
 * Server action that triggers a catalog sync from the /catalog page.
 *
 * Wires the real dependencies — the configured AmazonClient (FakeAmazonClient
 * when AMAZON_USE_FAKE=true) and the service-role admin client — into the
 * injectable `syncCatalog` orchestration, then revalidates the page so the
 * freshly-mirrored rows render. Both deps are server-only; this file runs only
 * on the server ('use server').
 */
export async function syncCatalogAction(): Promise<void> {
  // Server Actions are public endpoints — re-check auth independently of the
  // route-group layout gate.
  await requireUser();

  await syncCatalog({
    client: getAmazonClient(),
    admin: createAdminClient(),
  });

  revalidatePath('/catalog');
}
