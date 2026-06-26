import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { syncCatalogAction } from './actions';

/**
 * Catalog & Inventory (Module 1) — the catalog list view.
 *
 * Server component. Reads the `catalog_items` synced mirror through the
 * authenticated Supabase server client (RLS grants authenticated SELECT), and
 * renders sku / asin / title / image plus a "last synced" stamp. Empty state
 * prompts a sync. The mirror is rebuildable from Amazon (ADR-0001); the "Sync
 * now" button repopulates it via the service-role write path.
 */

type CatalogRow = {
  marketplace_id: string;
  sku: string;
  asin: string;
  title: string;
  image_url: string | null;
  synced_at: string;
};

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

  const { data, error } = await supabase
    .from('catalog_items')
    .select('marketplace_id, sku, asin, title, image_url, synced_at')
    .order('sku', { ascending: true });

  const rows = (data ?? []) as CatalogRow[];
  const lastSynced = mostRecentSyncedAt(rows);

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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
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
                </tr>
              ))}
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
