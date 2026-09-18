import Link from 'next/link';
import { analyticsBasisLabel, type AnalyticsSettings } from '@/lib/analytics/settings';

export function AnalyticsBasisNote({ settings }: { settings: AnalyticsSettings }) {
  return (
    <p className="text-xs text-muted">
      {analyticsBasisLabel(settings)}.{' '}
      <Link href="/settings#analytics" className="text-accent-strong underline underline-offset-2">
        Analytics settings
      </Link>
    </p>
  );
}
