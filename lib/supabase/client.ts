import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components (browser).
 *
 * Only reads the public URL and anon key — both are safe to ship to the
 * browser. Amazon credentials and the Amazon client are server-only and must
 * never be imported here.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
