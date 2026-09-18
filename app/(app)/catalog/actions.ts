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
 * cron (`runFullSync`), and SVD inventory refreshes only from the authenticated
 * user-triggered button on /reorder. Wires the real dependencies — the
 * configured AmazonClient (FakeAmazonClient when AMAZON_USE_FAKE=true) and the
 * service-role admin client — into the injectable `syncCatalog` and `syncInventory`
 * orchestrations. Inventory runs first, and each mirror reports its own outcome
 * so catalog throttling cannot block the stock refresh or crash the page.
 * Both clients are reused across the syncs; both deps are
 * server-only and this file runs only on the server ('use server').
 */
export async function syncCatalogAction(): Promise<{ message: string; error: string | null }> {
  // Server Actions are public endpoints — re-check auth independently of the
  // route-group layout gate.
  await requireUser();

  let client;
  let admin;
  try {
    client = getAmazonClient();
    admin = createAdminClient();
  } catch (error) {
    console.error('catalog refresh: dependency setup failed', error);
    return { message: '', error: 'Could not start the refresh. Check the server configuration and try again.' };
  }

  const messages: string[] = [];
  const errors: string[] = [];
  // Keep sequential requests to avoid adding pressure to Amazon's quotas.
  // Each sync retains its own write/error semantics, including FBA source health.
  for (const [label, sync] of [
    ['FBA inventory', syncInventory],
    ['Catalog', syncCatalog],
  ] as const) {
    try {
      const result = await sync({ client, admin });
      messages.push(`${label} refreshed (${result.count} SKUs).`);
    } catch (error) {
      console.error(`catalog refresh: ${label} failed`, error);
      const throttled = error instanceof Error && /^SP-API .* failed: 429\b/.test(error.message);
      errors.push(throttled
        ? `${label} could not refresh because Amazon is limiting requests. Try again in a few minutes.`
        : `${label} could not refresh. Try again later.`);
    }
  }

  // Invalidate even after a failure: a source's health may have changed.
  revalidatePath('/catalog');
  revalidatePath('/reorder');
  revalidatePath('/replenishment');
  revalidatePath('/analytics');
  return { message: messages.join(' '), error: errors.length ? errors.join(' ') : null };
}
