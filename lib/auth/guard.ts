import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadSessionUser } from "@/lib/auth/session";
import type { SessionUser } from "@/lib/auth/types";

/**
 * Require an authenticated user inside a Server Action or route handler.
 *
 * Server Actions are public POST endpoints — the `app/(app)/` layout's
 * `getUser()` gate protects page *rendering*, NOT action invocation. Each
 * action is a separate trust boundary and must re-check auth itself. Use this
 * at the top of every action that reads/writes user-scoped or privileged data.
 *
 * Redirects to /login when unauthenticated (so it never returns null).
 */
export async function requireUser(): Promise<SessionUser> {
  const supabase = await createClient();
  const user = await loadSessionUser(supabase);
  if (!user) redirect("/login");
  return user;
}
