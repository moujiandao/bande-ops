'use client';

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";

type NavItem = {
  label: string;
  href?: string;
  /** Coming-soon Module: rendered muted + disabled with a "Soon" tag. */
  soon?: boolean;
};

export type RouteNavigationEvent = Pick<
  MouseEvent<HTMLAnchorElement>,
  "altKey" | "button" | "ctrlKey" | "defaultPrevented" | "metaKey" | "shiftKey" | "preventDefault"
>;

type RouteNavigator = {
  push: (href: string) => void;
};

type StartTransition = (callback: () => void) => void;

const overview: NavItem[] = [{ label: "Dashboard", href: "/" }];

// Operational modules in workflow order. FBA replenishment and supplier reorder
// are separate decisions, even though they consume the same inventory mirrors.
const modules: NavItem[] = [
  { label: "Catalog & Inventory", href: "/catalog" },
  { label: "FBA Replenishment", href: "/replenishment" },
  { label: "Supplier Reorder", href: "/reorder" },
  { label: "Analytics", href: "/analytics" },
  { label: "Ads", href: "/ads" },
  { label: "Launch", soon: true },
  { label: "Research", soon: true },
];

// Cross-Module workspace config (e.g. replenishment settings — the operational
// inputs to the reorder math, not a Module of their own).
const workspace: NavItem[] = [{ label: "Settings", href: "/settings" }];

function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
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

  if (active) {
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
        onClick={(event) => onNavigate(event, item.href ?? "#")}
        className={`${base} text-ink-muted hover:bg-ink-raised hover:text-ink-foreground`}
    >
      <span>{item.label}</span>
    </Link>
  );
}

export function RouteLoadingVeil({ pending }: { pending: boolean }) {
  const veilRef = useRef<HTMLDivElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    const appShell = document.getElementById("app-shell");

    if (!pending) {
      if (wasPending.current) {
        document
          .querySelector<HTMLAnchorElement>('nav[aria-label="Primary"] a[aria-current="page"]')
          ?.focus();
        wasPending.current = false;
      }
      return;
    }

    wasPending.current = true;
    appShell?.setAttribute("aria-busy", "true");
    appShell?.setAttribute("inert", "");
    veilRef.current?.focus();

    return () => {
      appShell?.removeAttribute("aria-busy");
      appShell?.removeAttribute("inert");
    };
  }, [pending]);

  if (!pending) return null;

  const veil = (
    <div
      aria-label="Page navigation in progress"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4 backdrop-blur-[1px]"
      ref={veilRef}
      role="dialog"
      tabIndex={-1}
    >
      <div aria-live="polite" className="flex items-center gap-3 rounded-lg border border-border bg-panel px-5 py-4 shadow-xl" role="status">
        <span aria-hidden="true" className="flex items-center gap-1.5">
          {[0, 1, 2].map((index) => (
            <span
              data-loading-dot
              key={index}
              className="h-2 w-2 rounded-full bg-accent motion-safe:animate-bounce motion-reduce:animate-none"
              style={{ animationDelay: `${index * 150}ms` }}
            />
          ))}
        </span>
        <span className="text-sm font-medium text-foreground">Loading next page…</span>
      </div>
    </div>
  );

  return typeof document === "undefined" ? veil : createPortal(veil, document.body);
}

export function navigatePrimaryRoute({
  event,
  href,
  active,
  router,
  startTransition,
}: {
  event: RouteNavigationEvent;
  href: string;
  active: boolean;
  router: RouteNavigator;
  startTransition: StartTransition;
}) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    active
  ) {
    return;
  }

  event.preventDefault();
  startTransition(() => router.push(href));
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
      {children}
    </p>
  );
}

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isActive = (href: string | undefined) =>
    href === "/" ? pathname === "/" : Boolean(href && (pathname === href || pathname.startsWith(`${href}/`)));
  const navigate = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    navigatePrimaryRoute({ event, href, active: isActive(href), router, startTransition });
  };

  return (
    <nav aria-busy={isPending} aria-label="Primary" className="flex flex-col gap-4 px-2 py-3">
      <RouteLoadingVeil pending={isPending} />
      <div className="flex flex-col gap-0.5">
        <SectionLabel>Overview</SectionLabel>
        {overview.map((item) => (
          <NavRow key={item.label} item={item} active={isActive(item.href)} onNavigate={navigate} />
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionLabel>Modules</SectionLabel>
        {modules.map((item) => (
          <NavRow key={item.label} item={item} active={isActive(item.href)} onNavigate={navigate} />
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionLabel>Workspace</SectionLabel>
        {workspace.map((item) => (
          <NavRow key={item.label} item={item} active={isActive(item.href)} onNavigate={navigate} />
        ))}
      </div>
    </nav>
  );
}
