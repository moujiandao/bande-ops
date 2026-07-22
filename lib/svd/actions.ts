'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { HttpSvdClient } from './client';
import { refreshSvdInventory } from './sync';

export async function refreshSvdInventoryAction(): Promise<void> {
  await requireOwner();
  await refreshSvdInventory({
    admin: createAdminClient(),
    client: new HttpSvdClient(),
  });
  revalidatePath('/reorder');
}
