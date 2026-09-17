'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { HttpSvdClient } from './client';
import { refreshSvdInventory } from './sync';

export async function refreshSvdInventoryAction(): Promise<void> {
  await requireUser();
  await refreshSvdInventory({
    admin: createAdminClient(),
    client: new HttpSvdClient(),
  });
  revalidatePath('/reorder');
}
