import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 *
 * Wired to Next 16's async `cookies()` so the auth session is read from (and,
 * where permitted, written back to) the request cookie store. This is the only
 * way server-side code should reach Supabase.
 *
 * Note: in a plain Server Component the cookie store is read-only, so `setAll`
 * may throw. We swallow that case — session refresh is handled in middleware
 * (see `lib/supabase/middleware.ts`).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where the cookie store is
            // read-only. Safe to ignore — middleware refreshes the session.
          }
        },
      },
    },
  );
}
