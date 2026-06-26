import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every matched request and propagates
 * any rotated session cookies onto both the incoming request and the outgoing
 * response. This is the standard @supabase/ssr SSR pattern: Server Components
 * cannot write cookies, so token refresh lives here in middleware.
 *
 * IMPORTANT: do not run other logic between creating the client and calling
 * `getUser()`, and always return the `response` object unmodified (aside from
 * cookies), or you risk desyncing the browser and server sessions.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touch the session so expired access tokens are refreshed and the new
  // cookies flow through `setAll` above. Keep this call adjacent to client
  // creation per the @supabase/ssr guidance.
  await supabase.auth.getUser();

  return response;
}
