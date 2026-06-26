import type { ReactNode } from "react";

type BadgeVariant = "default" | "soon" | "accent";

const variantClass: Record<BadgeVariant, string> = {
  default: "border-border bg-panel-muted text-muted",
  soon: "border-border bg-transparent text-faint",
  accent: "border-transparent bg-accent-soft text-accent-strong",
};

/**
 * Tiny status pill. Used for the "Soon" tag on coming-soon Modules and for
 * small inline labels (e.g. the marketplace indicator). Override colors via
 * `className` when placing it on the dark ink sidebar.
 */
export function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${variantClass[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
