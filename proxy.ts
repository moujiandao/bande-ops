import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the `middleware` file convention to `proxy`. Same API:
// runs before cached responses, here refreshing the Supabase auth session.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every request path except those for static assets:
     * - _next/static (build output)
     * - _next/image (image optimization)
     * - favicon.ico and common image extensions
     * This keeps session refresh off the asset hot path.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
