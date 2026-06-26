import { Badge } from "@/components/ui/badge";

/**
 * Dashboard landing page. Renders inside the Ops App shell (mounted in
 * app/layout.tsx). Server component, no data fetching yet.
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="max-w-prose text-sm text-muted">
          Welcome to bande-ops — the single app for running Amazon Seller
          Central operations for the US store. Modules are built one at a time
          on top of the shared spine.
        </p>
      </header>

      <section className="max-w-md rounded-panel border border-border bg-panel p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">
            Module 1: Catalog &amp; Inventory
          </h2>
          <Badge variant="accent">In progress</Badge>
        </div>
        <p className="mt-2 text-sm text-muted">
          Synced mirror of catalog and inventory from Amazon, plus the
          operational layer for reorder recommendations.
        </p>
      </section>
    </div>
  );
}
