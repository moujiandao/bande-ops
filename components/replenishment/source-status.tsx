import { Badge } from '@/components/ui/badge';
import type { SourceHealthRow } from '@/lib/reorder/service';

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function SourceStatus({
  sourceHealth,
  loadErrors,
}: {
  sourceHealth: SourceHealthRow[];
  loadErrors: [string, string][];
}) {
  const attentionNeeded = sourceHealth.some((source) => source.status !== 'success');
  const attentionSummary = sourceHealth
    .filter((source) => source.status !== 'success')
    .map((source) => `${source.source.replaceAll('_', ' ')} ${source.status}`)
    .join(', ');

  return (
    <div className="flex flex-col gap-2">
      <details className="rounded-panel border border-border bg-panel">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs text-muted">
          <span className="font-medium text-foreground">Data status</span>
          <span className="flex items-center gap-2">
            {attentionNeeded ? (
              <Badge className="border-border bg-panel-muted text-muted">{attentionSummary}</Badge>
            ) : (
              <Badge variant="accent">All sources current</Badge>
            )}
            <span className="text-faint">Show details</span>
          </span>
        </summary>
        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {sourceHealth.map((source) => (
            <div key={source.source} className="bg-panel p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
                  {source.source.replaceAll('_', ' ')}
                </span>
                <Badge
                  className={
                    source.status === 'success'
                      ? 'border-accent-soft bg-accent-soft text-accent-strong'
                      : 'border-border bg-panel-muted text-muted'
                  }
                >
                  {source.status}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted">
                {source.lastSuccessAt
                  ? `Last refreshed ${formatTimestamp(source.lastSuccessAt)}`
                  : 'Never refreshed'}
                {source.rowCount === null ? '' : ` · ${source.rowCount} rows`}
              </p>
              {source.errorSummary ? (
                <p className="mt-1 text-[11px] text-muted">{source.errorSummary}</p>
              ) : null}
            </div>
          ))}
        </div>
      </details>
      {loadErrors.length > 0 ? (
        <div className="rounded-panel border border-border bg-panel-muted p-3 text-xs text-foreground">
          A source failed to load: {loadErrors.map(([name, message]) => `${name}: ${message}`).join('; ')}.
          Some rows need review until it recovers.
        </div>
      ) : null}
    </div>
  );
}
