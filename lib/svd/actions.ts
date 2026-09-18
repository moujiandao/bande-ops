'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { withRefreshLock } from '@/lib/sync/refresh-lock';
import { HttpSvdClient } from './client';
import { refreshSvdInventory } from './sync';

export async function refreshSvdInventoryAction(): Promise<void> {
  await requireUser();
  const admin = createAdminClient();
  await withRefreshLock({ admin, source: 'svd_inventory' }, async () => {
    await refreshSvdInventory({
      admin,
      client: new HttpSvdClient(),
    });
  });
  revalidatePath('/reorder');
  revalidatePath('/replenishment');
}
