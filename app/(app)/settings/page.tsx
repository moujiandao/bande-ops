import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import {
  saveDefaultsAction,
  savePolicyAction,
  saveSkuOverrideAction,
} from '@/lib/settings/settings-actions';
import { mapPolicyRow, type ReplenishmentPolicyRow } from '@/lib/settings/policy';

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
  lead_time_days: number;
  safety_stock: number;
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

  const [settingsRes, policyRes] = await Promise.all([
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
  ]);

  const rows = (settingsRes.data ?? []) as SettingRow[];
  const defaultRow = rows.find((r) => r.sku === null) ?? null;
  const overrides = rows.filter((r) => r.sku !== null);
  const policy = mapPolicyRow(
    (policyRes.data ?? null) as ReplenishmentPolicyRow | null,
  );

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
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>

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
                      defaultValue={row.lead_time_days}
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
                      defaultValue={row.safety_stock}
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
    </div>
  );
}
