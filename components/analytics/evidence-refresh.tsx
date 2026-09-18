'use client';

import { useActionState } from 'react';
import { refreshShipmentEvidenceAction } from '@/lib/shipments/actions';

export function EvidenceRefresh() {
  const [state, action, pending] = useActionState(refreshShipmentEvidenceAction, { message: '', error: null });
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50">
        {pending ? 'Refreshing…' : 'Refresh shipment evidence'}
      </button>
      <p role={state.error ? 'alert' : 'status'} className="text-xs text-muted">
        {pending ? 'Checking Amazon reports…' : state.error ?? state.message}
      </p>
    </form>
  );
}
