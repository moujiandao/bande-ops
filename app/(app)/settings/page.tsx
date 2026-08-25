import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import {
  saveDefaultsAction,
  savePolicyAction,
  saveSkuOverrideAction,
  saveSourceMappingAction,
  saveSvdUnitsPerBoxAction,
  saveBoxNameAction,
  deleteSourceMappingAction,
} from '@/lib/settings/settings-actions';
import {
  mapPolicyRow,
  SVD_TO_FBA_TARGET_OPTIONS,
  type ReplenishmentPolicyRow,
} from '@/lib/settings/policy';
import { assembleRecommendations } from '@/lib/reorder/service';

/**
 * Replenishment settings, the operational layer behind the reorder math.
 *
 * Server component. Reads `replenishment_settings` through the authenticated
 * Supabase server client (RLS grants authenticated SELECT/INSERT/UPDATE; these
 * rows are ours, user-authored, not a synced mirror). Renders a form to edit the
 * single global default (the row where `sku IS NULL`) and a section to set or
 * edit per-SKU overrides, which win over the default for that SKU.
 */

type SettingRow = {
  id: string;
  marketplace_id: string;
  sku: string | null;
  // Nullable on per-SKU rows (migration 0016): a row may exist to carry only a
  // box size, with lead time and safety stock inherited from the global default.
  lead_time_days: number | null;
  safety_stock: number | null;
  target_coverage_days: number | null;
  updated_at: string;
};

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/** Stored coverage is days; the UI works in months. Empty when unset. */
function coverageMonths(days: number | null): number | '' {
  return days === null ? '' : Math.round((days / 30) * 100) / 100;
}

const fieldClass =
  'w-full rounded-md border border-border bg-panel px-3 py-1.5 text-sm text-foreground tabular-nums focus:border-accent focus:outline-none';
const labelClass = 'text-xs font-medium text-muted';
const primaryButtonClass =
  'rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-colors hover:opacity-90';

export default async function SettingsPage() {
  const supabase = await createClient();

  const [settingsRes, policyRes, mappingsRes] = await Promise.all([
    supabase
      .from('replenishment_settings')
      .select(
        'id, marketplace_id, sku, lead_time_days, safety_stock, target_coverage_days, updated_at',
      )
      .order('sku', { ascending: true, nullsFirst: true }),
    supabase
      .from('replenishment_policy')
      .select('*')
      .eq('marketplace_id', 'ATVPDKIKX0DER')
      .maybeSingle(),
    supabase
      .from('inventory_source_mappings')
      .select('id, amazon_sku, svd_item_id, status')
      .eq('marketplace_id', 'ATVPDKIKX0DER')
      .order('amazon_sku', { ascending: true }),
  ]);

  const mappings = (mappingsRes.data ?? []) as {
    id: string;
    amazon_sku: string;
    svd_item_id: string;
    status: string;
  }[];

  const rows = (settingsRes.data ?? []) as SettingRow[];
  const defaultRow = rows.find((r) => r.sku === null) ?? null;
  // A per-SKU row is a lead-time/safety-stock override only when it actually
  // sets those. Rows that carry only an svd_units_per_box (created by the SVD
  // box section) are not overrides and belong in that section, not here.
  const overrides = rows.filter(
    (r) =>
      r.sku !== null &&
      (r.lead_time_days !== null ||
        r.safety_stock !== null ||
        r.target_coverage_days !== null),
  );
  const policy = mapPolicyRow(
    (policyRes.data ?? null) as ReplenishmentPolicyRow | null,
  );

  // SVD box configuration reuses the reorder assembly, which already resolves
  // each SKU's SVD box count and its configured pack size — no need to re-derive
  // SVD stock or mapping logic here. Only SKUs actually carried at SVD need a
  // pack size, so those are all that's shown; unset-with-stock float to the top
  // because they are the rows currently blocking a recommendation.
  const { rows: reorderRows } = await assembleRecommendations({ supabase });
  const svdBoxRows = reorderRows
    .filter((r) => r.svdBoxes !== null && r.svdBoxes > 0)
    .map((r) => ({
      sku: r.sku,
      boxes: r.svdBoxes as number,
      unitsPerBox: r.svdUnitsPerBox,
    }))
    .sort((a, b) => {
      const aUnset = a.unitsPerBox === null ? 0 : 1;
      const bUnset = b.unitsPerBox === null ? 0 : 1;
      if (aUnset !== bUnset) return aUnset - bUnset;
      return a.sku.localeCompare(b.sku);
    });
  const svdUnsetCount = svdBoxRows.filter((r) => r.unitsPerBox === null).length;

  // Box names apply to every active SKU (not just SVD-stocked ones), so this
  // list is the full active set, unlabelled first so gaps are easy to fill.
  const boxNameRows = reorderRows
    .filter((r) => !r.isLegacy)
    .map((r) => ({ sku: r.sku, boxName: r.boxName }))
    .sort((a, b) => {
      const aSet = a.boxName === null ? 0 : 1;
      const bSet = b.boxName === null ? 0 : 1;
      if (aSet !== bSet) return aSet - bSet;
      return a.sku.localeCompare(b.sku);
    });
  const boxNameUnsetCount = boxNameRows.filter((r) => r.boxName === null).length;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Replenishment settings
        </h1>
        <p className="max-w-prose text-sm text-muted">
          The inputs to the reorder math. The global default applies to every
          SKU; a per-SKU override wins for that SKU. Decision support only,
          nothing here writes back to Amazon.
        </p>
      </header>

      {settingsRes.error || policyRes.error ? (
        <div className="rounded-panel border border-border bg-panel-muted p-3 text-xs text-foreground">
          ⚠ Couldn&apos;t load settings
          {settingsRes.error ? ` (${settingsRes.error.message})` : ''}
          {policyRes.error ? ` (${policyRes.error.message})` : ''}. The forms
          below still submit, but current values may be missing.
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            Global reorder policy
          </h2>
          <Badge className="border-border bg-panel-muted text-muted">
            Applies globally
          </Badge>
        </div>

        <form
          action={savePolicyAction}
          className="flex flex-col gap-4 rounded-panel border border-border bg-panel p-5"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Velocity sample (in-stock days)</span>
              <input
                type="number"
                name="velocitySampleInStockDays"
                min={1}
                step={1}
                required
                defaultValue={policy.velocitySampleInStockDays}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Velocity max lookback (days)</span>
              <input
                type="number"
                name="velocityMaxLookbackDays"
                min={1}
                step={1}
                required
                defaultValue={policy.velocityMaxLookbackDays}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>SVD to FBA target cover</span>
              <select
                name="svdToFbaTargetDays"
                required
                defaultValue={policy.svdToFbaTargetDays}
                className={fieldClass}
              >
                {SVD_TO_FBA_TARGET_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-[11px] text-faint">
            SVD to FBA target cover controls only which SKUs appear in that
            transfer list and how many units it recommends shipping. It does not
            change supplier reorder quantities.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-md border border-border bg-panel-muted px-3 py-2 text-xs text-muted">
              <input
                type="checkbox"
                name="countInboundWorking"
                defaultChecked={policy.countInboundWorking}
              />
              Count FBA inbound working
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-panel-muted px-3 py-2 text-xs text-muted">
              <input
                type="checkbox"
                name="countInboundShipped"
                defaultChecked={policy.countInboundShipped}
              />
              Count FBA inbound shipped
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-panel-muted px-3 py-2 text-xs text-muted">
              <input
                type="checkbox"
                name="countInboundReceiving"
                defaultChecked={policy.countInboundReceiving}
              />
              Count FBA inbound receiving
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-panel-muted px-3 py-2 text-xs text-muted">
              <input
                type="checkbox"
                name="countAwdAvailable"
                defaultChecked={policy.countAwdAvailable}
              />
              Count AWD available to send
            </label>
            <label
              className="flex items-center gap-2 rounded-md border border-border bg-panel-muted px-3 py-2 text-xs text-muted"
              title="Units already in transit from AWD to FBA. Leave off unless FBA inbound excludes them — counting both double-counts the same units."
            >
              <input
                type="checkbox"
                name="countAwdReplenishment"
                defaultChecked={policy.countAwdReplenishment}
              />
              Count AWD in transit to FBA
            </label>
          </div>

          <div className="grid gap-2 text-xs text-muted sm:grid-cols-3">
            <span>Fulfillment: FBA only</span>
            <span>SVD: replenishment warehouse only</span>
            <span>Unknown/stale data: needs review</span>
          </div>

          <div className="flex justify-end">
            <button type="submit" className={primaryButtonClass}>
              Save policy
            </button>
          </div>
        </form>
      </section>

      {/* Global default */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Global default</h2>
          {defaultRow ? (
            <span className="text-[11px] text-faint">
              Updated {formatTimestamp(defaultRow.updated_at)}
            </span>
          ) : (
            <span className="text-[11px] text-faint">Not set yet</span>
          )}
        </div>

        <form
          action={saveDefaultsAction}
          className="flex flex-col gap-4 rounded-panel border border-border bg-panel p-5"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Lead time (days)</span>
              <input
                type="number"
                name="leadTimeDays"
                min={0}
                step={1}
                required
                defaultValue={defaultRow?.lead_time_days ?? 14}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Safety stock (units)</span>
              <input
                type="number"
                name="safetyStock"
                min={0}
                step={1}
                required
                defaultValue={defaultRow?.safety_stock ?? 0}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Target coverage (months)</span>
              <input
                type="number"
                name="coverageMonths"
                min={0.5}
                step={0.5}
                required
                defaultValue={coverageMonths(defaultRow?.target_coverage_days ?? 90) || 3}
                className={fieldClass}
              />
            </label>
          </div>
          <p className="text-[11px] text-faint">
            Coverage is how much stock to reorder up to once a SKU drops below its
            lead-time reorder point (e.g. 3 months of expected sales).
          </p>
          <div className="flex justify-end">
            <button type="submit" className={primaryButtonClass}>
              Save default
            </button>
          </div>
        </form>
      </section>

      {/* Per-SKU overrides */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Per-SKU overrides</h2>
          <Badge className="border-border bg-panel-muted text-muted">
            {overrides.length} override{overrides.length === 1 ? '' : 's'}
          </Badge>
        </div>

        {overrides.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {overrides.map((row) => (
              <li key={row.id}>
                <form
                  action={saveSkuOverrideAction}
                  className="grid items-end gap-3 rounded-panel border border-border bg-panel p-4 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem_auto]"
                >
                  <input type="hidden" name="sku" value={row.sku ?? ''} />
                  <div className="flex flex-col gap-1.5">
                    <span className={labelClass}>SKU</span>
                    <span className="truncate font-mono text-xs text-foreground">
                      {row.sku}
                    </span>
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className={labelClass}>Lead time</span>
                    <input
                      type="number"
                      name="leadTimeDays"
                      min={0}
                      step={1}
                      required
                      defaultValue={row.lead_time_days ?? undefined}
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={labelClass}>Safety stock</span>
                    <input
                      type="number"
                      name="safetyStock"
                      min={0}
                      step={1}
                      required
                      defaultValue={row.safety_stock ?? undefined}
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={labelClass}>Coverage (mo)</span>
                    <input
                      type="number"
                      name="coverageMonths"
                      min={0.5}
                      step={0.5}
                      placeholder="default"
                      defaultValue={coverageMonths(row.target_coverage_days)}
                      className={fieldClass}
                    />
                  </label>
                  <button type="submit" className={primaryButtonClass}>
                    Save
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-panel border border-dashed border-border bg-panel p-4 text-xs text-muted">
            No per-SKU overrides yet. Every SKU uses the global default above.
          </p>
        )}

        {/* Add a new override */}
        <form
          action={saveSkuOverrideAction}
          className="grid items-end gap-3 rounded-panel border border-dashed border-border bg-panel p-4 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem_auto]"
        >
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>New override: SKU</span>
            <input
              type="text"
              name="sku"
              required
              placeholder="e.g. DRUM-STICK-5A"
              className={`${fieldClass} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Lead time</span>
            <input
              type="number"
              name="leadTimeDays"
              min={0}
              step={1}
              required
              defaultValue={defaultRow?.lead_time_days ?? 14}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Safety stock</span>
            <input
              type="number"
              name="safetyStock"
              min={0}
              step={1}
              required
              defaultValue={defaultRow?.safety_stock ?? 0}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Coverage (mo)</span>
            <input
              type="number"
              name="coverageMonths"
              min={0.5}
              step={0.5}
              placeholder="default"
              className={fieldClass}
            />
          </label>
          <button type="submit" className={primaryButtonClass}>
            Add
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Box names</h2>
          <Badge className="border-border bg-panel-muted text-muted">
            {boxNameUnsetCount > 0
              ? `${boxNameUnsetCount} unlabelled`
              : `${boxNameRows.length} labelled`}
          </Badge>
        </div>
        <p className="max-w-prose text-xs text-muted">
          Your label for each SKU&apos;s physical box (e.g.{' '}
          <code className="font-mono">template 1 (2pack)</code>,{' '}
          <code className="font-mono">setA + booklet</code>). Shown on the reorder
          replenish list so a picker knows which box to pull. Free text; leave
          blank to clear. Unlabelled SKUs are listed first.
        </p>

        {boxNameRows.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {boxNameRows.map((r) => (
              <li
                key={r.sku}
                className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-panel px-4 py-3"
              >
                <span className="font-mono text-xs text-foreground">{r.sku}</span>
                <form
                  action={saveBoxNameAction}
                  className="flex items-center gap-2"
                >
                  <input type="hidden" name="sku" value={r.sku} />
                  <label className="flex items-center gap-2">
                    <span className={labelClass}>Box name</span>
                    <input
                      type="text"
                      name="boxName"
                      defaultValue={r.boxName ?? ''}
                      placeholder="unlabelled"
                      className={`${fieldClass} w-48`}
                    />
                  </label>
                  <button type="submit" className={primaryButtonClass}>
                    Save
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-panel border border-dashed border-border bg-panel p-4 text-xs text-muted">
            No active SKUs to label.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            SVD box configuration
          </h2>
          <Badge className="border-border bg-panel-muted text-muted">
            {svdUnsetCount > 0
              ? `${svdUnsetCount} need a size`
              : `${svdBoxRows.length} configured`}
          </Badge>
        </div>
        <p className="max-w-prose text-xs text-muted">
          SVD reports stock in <strong className="text-foreground">boxes</strong>;
          FBA and AWD report units. Set the units per box for each SKU so its SVD
          stock is counted correctly. A SKU with SVD stock but no size set can&apos;t
          be given a recommendation — it shows as{' '}
          <span className="font-mono">unknown svd units per box</span> on the
          reorder page until you fill it in. Only SKUs currently carried at SVD are
          listed.
        </p>

        {svdBoxRows.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {svdBoxRows.map((r) => (
              <li
                key={r.sku}
                className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-panel px-4 py-3"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs text-foreground">{r.sku}</span>
                  <span className="text-[11px] text-muted">
                    {r.boxes} boxes at SVD
                    {r.unitsPerBox !== null
                      ? ` → ${r.boxes * r.unitsPerBox} units`
                      : ' → needs a box size'}
                  </span>
                </div>
                <form
                  action={saveSvdUnitsPerBoxAction}
                  className="flex items-center gap-2"
                >
                  <input type="hidden" name="sku" value={r.sku} />
                  <label className="flex items-center gap-2">
                    <span className={labelClass}>Units / box</span>
                    <input
                      type="number"
                      name="svdUnitsPerBox"
                      min={1}
                      step={1}
                      defaultValue={r.unitsPerBox ?? ''}
                      placeholder="unset"
                      className={`${fieldClass} w-24`}
                    />
                  </label>
                  <button type="submit" className={primaryButtonClass}>
                    Save
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-panel border border-dashed border-border bg-panel p-4 text-xs text-muted">
            No SKUs currently have SVD stock.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            SVD item mappings
          </h2>
          <Badge className="border-border bg-panel-muted text-muted">
            {mappings.length} mapped
          </Badge>
        </div>
        <p className="max-w-prose text-xs text-muted">
          SVD item ids are matched to Amazon SKUs by name automatically. Add a
          mapping here only where the two systems disagree — for example SVD
          calls it <code className="font-mono">babyboy</code> while Amazon calls
          it <code className="font-mono">babytracker_notebook_boy_g2</code>. A
          mapping saved here always wins over the automatic match.
        </p>

        <form
          action={saveSourceMappingAction}
          className="flex flex-col gap-4 rounded-panel border border-border bg-panel p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Amazon SKU</span>
              <input
                type="text"
                name="amazonSku"
                required
                placeholder="babytracker_notebook_boy_g2"
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>SVD item id</span>
              <input
                type="text"
                name="svdItemId"
                required
                placeholder="babyboy"
                className={fieldClass}
              />
            </label>
          </div>
          <div>
            <button type="submit" className={primaryButtonClass}>
              Save mapping
            </button>
          </div>
        </form>

        {mappings.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {mappings.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border bg-panel px-4 py-3"
              >
                <span className="font-mono text-xs text-foreground">
                  {m.amazon_sku}{' '}
                  <span className="text-faint">←</span>{' '}
                  <span className="text-muted">{m.svd_item_id}</span>
                </span>
                <form action={deleteSourceMappingAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-panel-muted hover:text-foreground"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-panel border border-dashed border-border bg-panel p-4 text-xs text-muted">
            No manual mappings. Every SVD item is matched by name.
          </p>
        )}
      </section>
    </div>
  );
}
