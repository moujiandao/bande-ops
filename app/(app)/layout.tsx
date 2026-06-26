import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadSessionUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";

/**
 * Layout for the protected `(app)` route group: everything that requires auth
 * lives under here. We verify the user with `getUser()` (via loadSessionUser)
 * and bounce to /login when there is none; otherwise we render the AppShell
 * with the signed-in email + role so the topbar can show identity and later
 * gate on role.
 *
 * Middleware refreshes the session cookie on every request; this layout is the
 * authorization gate that turns "no verified user" into a redirect.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const sessionUser = await loadSessionUser(supabase);

  if (!sessionUser) redirect("/login");

  return (
    <AppShell user={{ name: sessionUser.email, role: sessionUser.role }}>
      {children}
    </AppShell>
  );
}
