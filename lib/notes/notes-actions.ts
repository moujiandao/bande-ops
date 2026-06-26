'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guard';

/**
 * Upsert a per-SKU operator note (Module 1: Catalog & Inventory).
 *
 * sku_notes is our OPERATIONAL layer (user-authored, authoritative — not a
 * synced mirror), so unlike catalog/inventory writes this goes through the
 * AUTHENTICATED server client and is governed by RLS (the migration opens
 * authenticated INSERT/UPDATE), NOT the service-role admin client.
 *
 * Server Actions are public POST endpoints, so we re-check auth via
 * requireUser() before touching the DB — the route-group layout gate protects
 * page rendering, not action invocation.
 *
 * Upserts on the natural key (marketplace_id, sku): the first save inserts,
 * later edits update in place. Revalidates /catalog so the table re-renders the
 * saved note.
 */
export async function upsertSkuNote(
  marketplaceId: string,
  sku: string,
  note: string,
): Promise<void> {
  await requireUser();

  const supabase = await createClient();

  const { error } = await supabase
    .from('sku_notes')
    .upsert(
      {
        marketplace_id: marketplaceId,
        sku,
        note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'marketplace_id,sku' },
    );

  if (error) {
    // Surface to the server log; the action contract is fire-and-revalidate, so
    // we throw to signal failure to the caller rather than silently swallowing.
    console.error('upsertSkuNote: write failed', error);
    throw new Error(`Failed to save note: ${error.message}`);
  }

  revalidatePath('/catalog');
}
