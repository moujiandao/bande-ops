import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

/**
 * Public sign-in route. Lives OUTSIDE the protected `(app)` group, so it has
 * no AppShell and no auth gate. If an already-signed-in user lands here, send
 * them on to the dashboard rather than showing a redundant login form.
 */
export default async function LoginPage() {
  const supabase = await createClient();
  const sessionUser = await loadSessionUser(supabase);
  if (sessionUser) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-panel border border-border bg-panel-muted p-6">
        <div className="mb-5 flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            bande-ops
          </h1>
          <p className="text-sm text-muted">
            Sign in to the Seller Central Ops App.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
