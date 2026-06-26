import 'server-only';

import { DEFAULT_MARKETPLACE, type Marketplace } from './types';

/**
 * Server-only Amazon credentials + endpoint config.
 *
 * Read lazily via {@link getAmazonConfig}, never at module load, so the app
 * builds and boots without creds present. The getter throws a clear error only
 * when a real SP-API call needs configuration.
 */
export interface AmazonConfig {
  lwaClientId: string;
  lwaClientSecret: string;
  refreshToken: string;
  useSandbox: boolean;
  /** Resolved SP-API host for the active marketplace + sandbox flag. */
  host: string;
  marketplace: Marketplace;
}

const REQUIRED_ENV = [
  'LWA_CLIENT_ID',
  'LWA_CLIENT_SECRET',
  'SPAPI_REFRESH_TOKEN',
] as const;

function readUseSandbox(): boolean {
  // Default to sandbox-first (see CLAUDE.md Non-Obvious Decisions).
  const raw = (process.env.AMAZON_USE_SANDBOX ?? 'true').trim().toLowerCase();
  return raw !== 'false';
}

/**
 * Resolve Amazon config from env. Throws a clear, actionable error if any
 * required variable is missing. Call this lazily (at request time), not at
 * import time.
 */
export function getAmazonConfig(
  marketplace: Marketplace = DEFAULT_MARKETPLACE,
): AmazonConfig {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Amazon SP-API config missing required env var(s): ${missing.join(', ')}. ` +
        `Set them in the server environment (.env.local / Vercel project env).`,
    );
  }

  const useSandbox = readUseSandbox();
  const host = useSandbox ? marketplace.sandboxHost : marketplace.host;

  return {
    lwaClientId: process.env.LWA_CLIENT_ID!.trim(),
    lwaClientSecret: process.env.LWA_CLIENT_SECRET!.trim(),
    refreshToken: process.env.SPAPI_REFRESH_TOKEN!.trim(),
    useSandbox,
    host,
    marketplace,
  };
}
