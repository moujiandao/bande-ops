"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SignInState } from "@/lib/auth/types";

/**
 * Server actions for the auth flow. This module is `'use server'`, so it may
 * only export async functions — shared types live in `@/lib/auth/types`.
 */

/**
 * Sign in with email + password. Shaped for `useActionState`: returns an error
 * state on failure, redirects to the dashboard on success (redirect throws, so
 * there is no success return value). Sign-up is intentionally absent — users
 * are created in the Supabase dashboard.
 */
export async function signIn(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Don't leak which half was wrong — generic credential error.
    return { error: "Invalid email or password." };
  }

  redirect("/");
}

/** Clear the session and return to the login page. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    // Local cookies are still cleared by the SSR flow; surface a failed global
    // token revoke instead of swallowing it silently.
    console.error("signOut: token revoke failed", error);
  }
  redirect("/login");
}
