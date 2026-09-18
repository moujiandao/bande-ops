'use client';

import { useActionState, useState } from 'react';
import { saveAnalyticsSettingsAction } from '@/lib/analytics/settings-actions';
import { vineAdjustmentIssue, type AnalyticsSettings, type SaveAnalyticsState } from '@/lib/analytics/settings';
import type { ShipmentEvidenceStatus } from '@/lib/shipments/read';
import { EvidenceRefresh } from './evidence-refresh';

export function AnalyticsSettingsForm({ settings, evidence }: { settings: AnalyticsSettings; evidence?: ShipmentEvidenceStatus }) {
  const [state, action, pending] = useActionState(saveAnalyticsSettingsAction, {
    saved: null,
    error: null,
  });
  return <AnalyticsSettingsFields key={String(settings.excludeVine)} settings={settings} evidence={evidence} state={state} action={action} pending={pending} />;
}

function AnalyticsSettingsFields({ settings, evidence, state, action, pending }: {
  settings: AnalyticsSettings;
  evidence?: ShipmentEvidenceStatus;
  state: SaveAnalyticsState;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [excludeVine, setExcludeVine] = useState(settings.excludeVine ?? false);
  // Server props are the persisted basis, including changes by another user.
  // The parent retains action feedback; this draft resets when that basis changes.
  const saved = settings.excludeVine;
  const changed = excludeVine !== saved;
  const issue = vineAdjustmentIssue({ excludeVine: saved, error: settings.error }, evidence);

  return (
    <section id="analytics" className="rounded-panel border border-border bg-panel p-5">
      <h2 className="text-sm font-semibold text-foreground">Analytics</h2>
      <p className="mt-1 text-xs text-muted">
        Choose the sales-momentum basis for all users in this marketplace.
        This affects Analytics and Momentum on both planning pages. Inventory,
        configured forecasts, supplier order quantities, and transfer quantities stay unchanged.
      </p>
      <form action={action} className="mt-4 flex flex-col items-start gap-3">
        <input type="hidden" name="excludeVine" value={String(excludeVine)} />
        <label className="flex items-center gap-3 text-sm text-foreground">
          <input
            type="checkbox"
            role="switch"
            checked={excludeVine}
            onChange={(event) => setExcludeVine(event.target.checked)}
            disabled={pending || settings.excludeVine === null}
            aria-describedby="vine-setting-help"
            className="h-4 w-4 accent-accent"
          />
          Exclude Vine and full-discount giveaways from sales momentum
        </label>
        <p id="vine-setting-help" className="text-xs text-muted">
          Off includes all shipments. On subtracts matched Vine and fully discounted
          item shipments. Partial discounts and free shipping stay included when
          item attribution is clear. Ambiguous days remain unknown.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending || !changed || settings.excludeVine === null}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground disabled:opacity-50">
            {pending ? 'Saving…' : 'Save analytics setting'}
          </button>
          <p role="status" className="text-xs text-muted">
            {pending ? 'Saving for all users…' : changed ? 'Unsaved change' : state.saved !== null && state.saved === saved ? 'Saved for all users' : 'Applies to all users'}
          </p>
        </div>
        {state.error ? <p role="alert" className="text-xs text-red-600">{state.error}</p> : null}
        {issue ? <p role="status" className="text-xs text-muted">{issue}</p> : null}
      </form>
      <p className="mt-3 text-xs text-muted">
        {evidence?.throughDate ? `Shipment reports through ${evidence.throughDate} (Pacific dates). ` : 'Shipment evidence has not completed yet. '}
        {evidence?.pending ? 'A report refresh is processing. ' : ''}
        The daily sync collects evidence even while this setting is off. Historical
        coverage builds in batches; reports may take more than one sync to complete.
      </p>
      <EvidenceRefresh />
    </section>
  );
}
