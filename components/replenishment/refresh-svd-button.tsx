'use client';

import { useState, useTransition } from 'react';
import { refreshSvdInventoryAction } from '@/lib/svd/actions';

const buttonClass =
  'rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-panel-muted disabled:cursor-wait disabled:opacity-60';

/** A manual SVD refresh needs visible progress and an outcome, not a silent POST. */
export function RefreshSvdButton() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function refresh() {
    setMessage(null);
    startTransition(async () => {
      try {
        await refreshSvdInventoryAction();
        setMessage('SVD inventory refreshed.');
      } catch {
        setMessage('SVD refresh failed. Check the data status for details and try again.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={refresh} disabled={isPending} className={buttonClass}>
        {isPending ? 'Refreshing SVD…' : 'Refresh SVD'}
      </button>
      {message ? (
        <p role="status" className="text-[11px] text-muted">{message}</p>
      ) : null}
    </div>
  );
}
