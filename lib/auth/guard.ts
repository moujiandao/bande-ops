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

/**
 * Require an authenticated user whose role is `owner`.
 *
 * This is the authorization gate for PRIVILEGED, state-changing actions — most
 * importantly the FIRST write-back to Amazon (pause a campaign, change a daily
 * budget). Only the `owner` may execute those; `staff` can view recommendations
 * but never act.
 *
 * Builds on {@link requireUser}: an unauthenticated caller is redirected to
 * /login (never returns), and an authenticated NON-owner is rejected by throwing
 * — a write action must FAIL LOUD, not silently no-op or quietly redirect away
 * while the caller assumes success. Returns the owner {@link SessionUser}.
 */
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "owner") {
    throw new Error("Forbidden: this action requires the owner role.");
  }
  return user;
}
