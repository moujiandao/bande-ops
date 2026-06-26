import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

type NavItem = {
  label: string;
  href?: string;
  /** Marks the currently-viewed item. The shell hard-codes Dashboard for now. */
  active?: boolean;
  /** Coming-soon Module: rendered muted + disabled with a "Soon" tag. */
  soon?: boolean;
};

const overview: NavItem[] = [{ label: "Dashboard", href: "/", active: true }];

// The four Modules of the Ops App. Catalog & Inventory is the Module being
// built; the rest are not yet available.
const modules: NavItem[] = [
  { label: "Catalog & Inventory", href: "/catalog" },
  { label: "Reorder", href: "/reorder" },
  { label: "Ads", soon: true },
  { label: "Launch", soon: true },
  { label: "Research", soon: true },
];

// Cross-Module workspace config (e.g. replenishment settings — the operational
// inputs to the reorder math, not a Module of their own).
const workspace: NavItem[] = [{ label: "Settings", href: "/settings" }];

function NavRow({ item }: { item: NavItem }) {
  const base =
    "group flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors";

  if (item.soon) {
    return (
      <div
        aria-disabled="true"
        className={`${base} cursor-not-allowed text-ink-faint select-none`}
      >
        <span>{item.label}</span>
        <Badge variant="soon" className="border-ink-border text-ink-faint">
          Soon
        </Badge>
      </div>
    );
  }

  if (item.active) {
    return (
      <Link
        href={item.href ?? "#"}
        aria-current="page"
        className={`${base} relative bg-ink-active font-medium text-ink-foreground before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-accent`}
      >
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <Link
      href={item.href ?? "#"}
      className={`${base} text-ink-muted hover:bg-ink-raised hover:text-ink-foreground`}
    >
      <span>{item.label}</span>
    </Link>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
      {children}
    </p>
  );
}

export function Nav() {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-4 px-2 py-3">
      <div className="flex flex-col gap-0.5">
        <SectionLabel>Overview</SectionLabel>
        {overview.map((item) => (
          <NavRow key={item.label} item={item} />
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionLabel>Modules</SectionLabel>
        {modules.map((item) => (
          <NavRow key={item.label} item={item} />
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionLabel>Workspace</SectionLabel>
        {workspace.map((item) => (
          <NavRow key={item.label} item={item} />
        ))}
      </div>
    </nav>
  );
}
