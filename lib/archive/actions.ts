'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/guard';
import { DEFAULT_MARKETPLACE } from '@/lib/amazon/types';
import { createClient } from '@/lib/supabase/server';

function readSku(formData: FormData): string {
  const sku = String(formData.get('sku') ?? '').trim();
  if (!sku) throw new Error('A SKU is required.');
  return sku;
}

function revalidateArchiveViews(): void {
  revalidatePath('/catalog');
  revalidatePath('/reorder');
  revalidatePath('/replenishment');
  revalidatePath('/settings');
}

export async function archiveSkuAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sku = readSku(formData);
  const supabase = await createClient();

  const { error } = await supabase.from('archived_skus').upsert(
    {
      marketplace_id: DEFAULT_MARKETPLACE.id,
      sku,
      archived_at: new Date().toISOString(),
      archived_by: user.id,
    },
    { onConflict: 'marketplace_id,sku' },
  );
  if (error) throw new Error(`Could not archive ${sku}: ${error.message}`);

  revalidateArchiveViews();
}

export async function unarchiveSkuAction(formData: FormData): Promise<void> {
  await requireUser();
  const sku = readSku(formData);
  const supabase = await createClient();

  const { error } = await supabase
    .from('archived_skus')
    .delete()
    .eq('marketplace_id', DEFAULT_MARKETPLACE.id)
    .eq('sku', sku);
  if (error) throw new Error(`Could not unarchive ${sku}: ${error.message}`);

  revalidateArchiveViews();
}
