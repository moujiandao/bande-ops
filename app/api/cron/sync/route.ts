import { NextResponse } from 'next/server';
import { getAmazonClient } from '@/lib/amazon';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncCatalog } from '@/lib/catalog/sync';
import { syncInventory } from '@/lib/inventory/sync';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';

/**
 * Scheduled full sync endpoint (Vercel Cron — see `vercel.json`).
 *
 * The same orchestration the "Sync now" server action runs, but driven on a
 * schedule instead of a click: refresh both synced mirrors (catalog +
 * inventory) from Amazon via the service-role admin client. Unlike the catalog
 * page action there is no logged-in user here, so auth is a shared-secret /
 * platform-header check (`isAuthorizedCronRequest`) rather than `requireUser()`.
 *
 * Node runtime + dynamic: this pulls server-only modules (admin client,
 * Amazon SP-API client) and must never be statically cached.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers, { CRON_SECRET: process.env.CRON_SECRET })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const client = getAmazonClient();
  const admin = createAdminClient();

  // Reuse both clients across the two syncs, mirroring the manual action.
  const catalog = await syncCatalog({ client, admin });
  const inventory = await syncInventory({ client, admin });

  return NextResponse.json({
    ok: true,
    counts: {
      catalog: catalog.count,
      inventory: inventory.count,
    },
  });
}
