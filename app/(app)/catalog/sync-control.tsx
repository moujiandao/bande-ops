'use client';

import { useActionState } from 'react';
import { syncCatalogAction } from './actions';

export function CatalogSyncControl() {
  const [state, action, pending] = useActionState(syncCatalogAction, {
    message: '', error: null,
  });

  return (
    <form action={action} className="flex max-w-sm flex-col items-start gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-panel-muted disabled:cursor-wait disabled:opacity-50"
      >
        {pending ? 'Syncing…' : 'Sync now'}
      </button>
      <p role="status" className="text-xs text-muted">
        {pending ? 'Refreshing FBA inventory and catalog from Amazon…' : state.message}
      </p>
      {!pending && state.error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
    </form>
  );
}
