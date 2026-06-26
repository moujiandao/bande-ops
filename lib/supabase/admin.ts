import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client authenticated with the SERVICE ROLE key.
 *
 * The service role bypasses RLS, so this is the only client allowed to WRITE
 * synced mirrors (e.g. `public.catalog_items`). It must never be imported by a
 * client component or reach the browser — `import 'server-only'` makes such an
 * import a build error.
 *
 * Env is read lazily (inside the factory, not at module load) so importing this
 * module never throws; the clear error only fires if you actually call it
 * without the required env present.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      'createAdminClient: NEXT_PUBLIC_SUPABASE_URL is not set. The service-role admin client cannot be created without it.',
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      'createAdminClient: SUPABASE_SERVICE_ROLE_KEY is not set. The service-role admin client cannot be created without it.',
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      // No session persistence/refresh: this is a stateless server client keyed
      // by the service role, not a logged-in user.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
