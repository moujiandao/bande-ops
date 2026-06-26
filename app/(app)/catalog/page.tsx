import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { formatInventoryLevel } from '@/lib/inventory/format';
import { syncCatalogAction } from './actions';

/**
 * Catalog & Inventory (Module 1) — the catalog list view.
 *
 * Server component. Reads the `catalog_items` synced mirror through the
 * authenticated Supabase server client (RLS grants authenticated SELECT), and
 * renders sku / asin / title / image, the inventory level, plus a "last synced"
 * stamp. Inventory comes from the sibling `inventory_levels` mirror, looked up
 * per row on (marketplace_id, sku); a null quantity or a missing row renders as
 * a distinct "Unknown" badge, NEVER as 0 (UNKNOWN-stock rule). Empty state
 * prompts a sync. The mirrors are rebuildable from Amazon (ADR-0001); the "Sync
 * now" button repopulates them via the service-role write path.
 */

type CatalogRow = {
  marketplace_id: string;
  sku: string;
  asin: string;
  title: string;
  image_url: string | null;
  synced_at: string;
};

type InventoryRow = {
  marketplace_id: string;
  sku: string;
  total_quantity: number | null;
};

/** Composite natural key shared by both mirrors. */
function rowKey(r: { marketplace_id: string; sku: string }): string {
  return `${r.marketplace_id}:${r.sku}`;
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function mostRecentSyncedAt(rows: CatalogRow[]): string | null {
  if (rows.length === 0) return null;
  return rows.reduce(
    (latest, row) => (row.synced_at > latest ? row.synced_at : latest),
    rows[0].synced_at,
  );
}

export default async function CatalogPage() {
  const supabase = await createClient();

  // Two reads against the sibling mirrors, then join in memory on the shared
  // (marketplace_id, sku) key. We keep them as separate selects (rather than a
  // PostgREST embedded join) because the mirrors have no declared FK
  // relationship — they are independently rebuildable from Amazon.
  const [catalogRes, inventoryRes] = await Promise.all([
    supabase
      .from('catalog_items')
      .select('marketplace_id, sku, asin, title, image_url, synced_at')
      .order('sku', { ascending: true }),
    supabase
      .from('inventory_levels')
      .select('marketplace_id, sku, total_quantity'),
  ]);

  const { data, error } = catalogRes;

  const rows = (data ?? []) as CatalogRow[];
  const lastSynced = mostRecentSyncedAt(rows);

  // Lookup of inventory level by composite key. A SKU with no entry here falls
  // through to the UNKNOWN state in formatInventoryLevel — never 0.
  const inventoryByKey = new Map<string, number | null>(
    ((inventoryRes.data ?? []) as InventoryRow[]).map((r) => [
      rowKey(r),
      r.total_quantity,
    ]),
  );

  // Distinguish an inventory READ FAILURE from a genuine UNKNOWN. If this query
  // failed, every row would otherwise silently fall through to the "Unknown"
  // badge — indistinguishable from Amazon actually reporting no quantity.
  const inventoryError = inventoryRes.error;
  if (inventoryError) {
    console.error('catalog: inventory_levels read failed', inventoryError);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Catalog &amp; Inventory
          </h1>
          <p className="max-w-prose text-sm text-muted">
            Synced mirror of your Amazon catalog. Amazon is the source of truth;
            this view is rebuildable and shows when it was last pulled.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastSynced ? (
            <span className="text-xs text-muted">
              Last synced{' '}
              <time dateTime={lastSynced} className="font-medium text-foreground">
                {formatTimestamp(lastSynced)}
              </time>
            </span>
          ) : (
            <span className="text-xs text-faint">Never synced</span>
          )}
          <form action={syncCatalogAction}>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-panel-muted"
            >
              Sync now
            </button>
          </form>
        </div>
      </header>

      {inventoryError ? (
        <div className="rounded-panel border border-border bg-panel-muted p-3 text-xs text-foreground">
          ⚠ Inventory levels failed to load ({inventoryError.message}). Levels
          below read &ldquo;Unknown&rdquo; because of this load error — not
          because Amazon reported them as unknown.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-panel border border-border bg-panel p-5 text-sm text-muted">
          Couldn&apos;t load the catalog mirror: {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-panel border border-dashed border-border bg-panel p-8">
          <h2 className="text-sm font-medium text-foreground">
            No catalog items yet
          </h2>
          <p className="max-w-prose text-sm text-muted">
            The mirror is empty. Run a sync to pull your catalog from Amazon into
            this view.
          </p>
          <form action={syncCatalogAction}>
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:opacity-90"
            >
              Sync now
            </button>
          </form>
        </div>
      ) : (
        <div className="overflow-hidden rounded-panel border border-border bg-panel">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-faint">
                <th className="w-16 px-4 py-3 font-medium">Image</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">ASIN</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 text-right font-medium">Inventory</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                // null OR a missing inventory row -> UNKNOWN (distinct from 0).
                const level = formatInventoryLevel(
                  inventoryByKey.get(rowKey(row)),
                );
                return (
                <tr
                  key={`${row.marketplace_id}:${row.sku}`}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-4 py-3">
                    {row.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.image_url}
                        alt={row.title}
                        className="h-10 w-10 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-faint"
                      >
                        N/A
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">
                    {row.sku}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {row.asin}
                  </td>
                  <td className="px-4 py-3 text-foreground">{row.title}</td>
                  <td className="px-4 py-3 text-right">
                    {level.isUnknown ? (
                      // UNKNOWN (null / no row): a muted badge, visually
                      // distinct from a numeric 0. Never rendered as "0".
                      <span title="Amazon did not report a quantity - flagged for review">
                        <Badge variant="soon">{level.label}</Badge>
                      </span>
                    ) : (
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {level.label}
                      </span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
            <span className="text-[11px] text-faint">
              {rows.length} item{rows.length === 1 ? '' : 's'}
            </span>
            <Badge className="border-border bg-panel-muted text-muted">US</Badge>
          </div>
        </div>
      )}
    </div>
  );
}
