/**
 * Shared auth types for the spine. Kept in their own module (not the
 * server-action files) so they can be imported from both server actions
 * (`'use server'`, which may only export async functions) and client
 * components without tripping Next's action-export restriction.
 */

/** The entire authorization model for now: two roles, owner > staff. */
export type Role = "owner" | "staff";

/**
 * The signed-in user as the shell needs it: identity + email for display and
 * `role` for later gating. Resolved from Supabase auth + `public.profiles`.
 */
export type SessionUser = {
  id: string;
  email: string;
  role: Role;
};

/** useActionState shape for the sign-in form: null error = no attempt yet. */
export type SignInState = {
  error: string | null;
};
