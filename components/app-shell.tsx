import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { signOut } from "@/lib/auth/actions";

type AppShellUser = {
  name: string;
  role: string;
};

const placeholderUser: AppShellUser = {
  name: "Signed-in user",
  role: "Operator",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const chars = parts.map((p) => p[0] ?? "").join("");
  return (chars || "?").toUpperCase();
}

/**
 * The Ops App UI shell: a constant ink sidebar (brand + Nav + marketplace
 * footer), a sticky top bar (app name + user/role slot), and the main content
 * region. Server component — nothing here needs client interactivity.
 *
 * The integrator mounts this in app/layout.tsx around {children}.
 */
export function AppShell({
  children,
  user = placeholderUser,
}: {
  children: ReactNode;
  user?: AppShellUser;
}) {
  return (
    <div className="min-h-screen bg-surface text-foreground">
      {/* Sidebar — fixed, constant ink chrome. Hidden on small screens. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-ink text-ink-foreground md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-ink-border px-4">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-foreground"
          >
            b
          </span>
          <span className="text-xs font-medium uppercase tracking-[0.16em] text-ink-muted">
            Ops App
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <Nav />
        </div>

        <div className="flex items-center justify-between border-t border-ink-border px-4 py-3">
          <span className="text-[11px] text-ink-faint">Marketplace</span>
          <Badge className="border-ink-border bg-ink-raised text-ink-muted">
            US
          </Badge>
        </div>
      </aside>

      {/* Content column, offset by the fixed sidebar on md+. */}
      <div className="flex min-h-screen flex-col md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-border bg-panel/85 px-4 backdrop-blur md:px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              bande-ops
            </span>
            <span className="hidden text-xs text-faint sm:inline">
              Seller Central operations
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-xs font-medium text-foreground">
                {user.name}
              </div>
              <div className="text-[11px] text-muted">{user.role}</div>
            </div>
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border-strong bg-panel-muted text-[11px] font-semibold text-muted"
            >
              {initials(user.name)}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-panel-muted hover:text-foreground"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
