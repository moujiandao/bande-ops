import { NextResponse } from 'next/server';
import { getAmazonClient } from '@/lib/amazon';
import { getAdsClient } from '@/lib/ads';
import { createAdminClient } from '@/lib/supabase/admin';
import { runFullSync } from '@/lib/cron/sync-all';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';

/**
 * Scheduled full sync endpoint (Vercel Cron — see `vercel.json`).
 *
 * The same orchestration the page "Sync now" actions run, but driven on a
 * schedule instead of a click: refresh every synced mirror — catalog + inventory
 * (from SP-API) AND ads campaigns + campaign metrics (from the Advertising API)
 * — via the service-role admin client. One scheduled tick refreshes all four.
 * Unlike the page actions there is no logged-in user here, so auth is a
 * shared-secret / platform-header check (`isAuthorizedCronRequest`) rather than
 * `requireUser()`.
 *
 * Node runtime + dynamic: this pulls server-only modules (admin client, the
 * Amazon SP-API and Advertising clients) and must never be statically cached.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers, { CRON_SECRET: process.env.CRON_SECRET })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Wire the real clients into the injectable full-sync orchestration. One admin
  // client is shared across all mirror writes, mirroring the manual actions.
  const counts = await runFullSync({
    amazonClient: getAmazonClient(),
    adsClient: getAdsClient(),
    admin: createAdminClient(),
  });

  return NextResponse.json({ ok: true, counts });
}
