import type { createClient } from "@/lib/supabase/server";
import type { Role, SessionUser } from "@/lib/auth/types";

/**
 * The exact type `createClient()` resolves to. Typing against this keeps the
 * production call site honest; tests pass a structural mock cast to this type.
 */
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Resolve the current request's signed-in user, or `null` when logged out.
 *
 * Trust comes from `getUser()` (verifies the JWT with Supabase) — never
 * `getSession()`, which only decodes the cookie. The role is read from
 * `public.profiles`; a missing/unknown role falls back to `staff` (least
 * privilege) rather than throwing, so a half-provisioned account still loads
 * the shell as the lowest-privilege user.
 *
 * Pure data access: it does NOT redirect. Callers (e.g. the protected layout)
 * decide what to do with a `null` result. That split is what makes the
 * redirect decision testable without rendering a Server Component.
 */
export async function loadSessionUser(
  supabase: SupabaseServerClient,
): Promise<SessionUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;

  const user = data.user;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError) {
    // Still degrade to least privilege below, but make a real DB/RLS failure
    // observable — otherwise an owner silently loads as staff and it looks like
    // an auth bug rather than a backend fault.
    console.error("loadSessionUser: profile lookup failed", profileError);
  }

  const role: Role = profile?.role === "owner" ? "owner" : "staff";

  return {
    id: user.id,
    email: user.email ?? "",
    role,
  };
}
