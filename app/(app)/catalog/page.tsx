import { createClient } from '@/lib/supabase/server';
import { syncCatalogAction } from './actions';
import { CatalogTable, type CatalogTableRow } from './catalog-table';

/**
 * Catalog & Inventory (Module 1) — the catalog list view.
 *
 * Server component. Reads three sources through the authenticated Supabase
 * server client (RLS): the `catalog_items` + `inventory_levels` synced mirrors
 * and the `sku_notes` operational table (user-authored notes — see ADR-0001),
 * then joins them in memory on the shared (marketplace_id, sku) key. The joined
 * rows are handed to the client `CatalogTable`, which owns search, sort, and the
 * inline note editor. Inventory is keyed per row; a null quantity or a missing
 * row renders as a distinct "Unknown" badge, NEVER as 0 (UNKNOWN-stock rule).
 * Empty state prompts a sync. The mirrors are rebuildable from Amazon (ADR-0001);
 * the "Sync now" button repopulates them via the service-role write path.
 */

type CatalogItemRow = {
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

type NoteRow = {
  marketplace_id: string;
  sku: string;
  note: string;
};

/** Composite natural key shared by the mirrors and the notes table. */
function rowKey(r: { marketplace_id: string; sku: string }): string {
  return `${r.marketplace_id}:${r.sku}`;
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function mostRecentSyncedAt(rows: CatalogItemRow[]): string | null {
  if (rows.length === 0) return null;
  return rows.reduce(
    (latest, row) => (row.synced_at > latest ? row.synced_at : latest),
    rows[0].synced_at,
  );
}

export default async function CatalogPage() {
  const supabase = await createClient();

  // Three reads, then join in memory on the shared (marketplace_id, sku) key. We
  // keep them as separate selects (rather than a PostgREST embedded join)
  // because the tables have no declared FK relationship — the mirrors are
  // independently rebuildable from Amazon and sku_notes is our own layer.
  const [catalogRes, inventoryRes, notesRes] = await Promise.all([
    supabase
      .from('catalog_items')
      .select('marketplace_id, sku, asin, title, image_url, synced_at')
      .order('sku', { ascending: true }),
    supabase
      .from('inventory_levels')
      .select('marketplace_id, sku, total_quantity'),
    supabase.from('sku_notes').select('marketplace_id, sku, note'),
  ]);

  const { data, error } = catalogRes;

  const catalogRows = (data ?? []) as CatalogItemRow[];
  const lastSynced = mostRecentSyncedAt(catalogRows);

  // Lookup of inventory level by composite key. A SKU with no entry here falls
  // through to the UNKNOWN state in formatInventoryLevel — never 0.
  const inventoryByKey = new Map<string, number | null>(
    ((inventoryRes.data ?? []) as InventoryRow[]).map((r) => [
      rowKey(r),
      r.total_quantity,
    ]),
  );

  // Lookup of note text by composite key. A SKU with no note row defaults to ''.
  const noteByKey = new Map<string, string>(
    ((notesRes.data ?? []) as NoteRow[]).map((r) => [rowKey(r), r.note]),
  );

  // Distinguish an inventory READ FAILURE from a genuine UNKNOWN. If this query
  // failed, every row would otherwise silently fall through to the "Unknown"
  // badge — indistinguishable from Amazon actually reporting no quantity.
  const inventoryError = inventoryRes.error;
  if (inventoryError) {
    console.error('catalog: inventory_levels read failed', inventoryError);
  }
  if (notesRes.error) {
    console.error('catalog: sku_notes read failed', notesRes.error);
  }

  // Join the three sources into the row shape the client table renders.
  const rows: CatalogTableRow[] = catalogRows.map((row) => {
    const key = rowKey(row);
    return {
      marketplace_id: row.marketplace_id,
      sku: row.sku,
      asin: row.asin,
      title: row.title,
      image_url: row.image_url,
      // get() returns undefined for a missing key; formatInventoryLevel treats
      // undefined the same as null (UNKNOWN), so coalesce to null here.
      total_quantity: inventoryByKey.get(key) ?? null,
      note: noteByKey.get(key) ?? '',
    };
  });

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
        <CatalogTable rows={rows} />
      )}
    </div>
  );
}
