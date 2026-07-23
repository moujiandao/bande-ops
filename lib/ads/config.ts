import 'server-only';

/**
 * Server-only Amazon Advertising API credentials + endpoint config.
 *
 * The Advertising API is a SEPARATE API from SP-API: it has its own LWA client
 * (ADS_CLIENT_ID / ADS_CLIENT_SECRET), its own long-lived refresh token
 * (ADS_REFRESH_TOKEN), and a profile id (ADS_PROFILE_ID) that scopes every
 * request to one advertising account/marketplace. These are distinct from the
 * SP-API creds in `lib/amazon/config.ts` — do not share them.
 *
 * Read lazily via {@link getAdsConfig}, never at module load, so the app builds
 * and boots without creds present. The getter throws a clear error only when a
 * real Advertising API call needs configuration.
 */
export interface AdsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Advertising profile id — scopes requests (Amazon-Advertising-API-Scope). */
  profileId: string;
  useSandbox: boolean;
  /** Resolved Advertising API host for the active sandbox flag. */
  host: string;
}

const REQUIRED_ENV = [
  'ADS_CLIENT_ID',
  'ADS_CLIENT_SECRET',
  'ADS_REFRESH_TOKEN',
  'ADS_PROFILE_ID',
] as const;

// Advertising API hosts (North America region). The sandbox host serves canned
// data and is used until we flip to production. TODO: verify against sandbox.
const PROD_HOST = 'advertising-api.amazon.com';
const SANDBOX_HOST = 'advertising-api-test.amazon.com';

/**
 * Whether Advertising API calls target the sandbox host.
 *
 * Exported so `lib/env/mode.ts` can report what is actually live by calling
 * this rather than reimplementing the precedence. Note the `??` chain below is
 * load-bearing: an empty-but-set ADS_USE_SANDBOX short-circuits and keeps this
 * client on the sandbox host, which a `||` chain would silently get wrong.
 */
export function readUseSandbox(): boolean {
  // Ads has its own sandbox switch so it can be promoted to production
  // independently of SP-API (separate creds, separate rollout). Falls back to
  // the shared AMAZON_USE_SANDBOX, then sandbox-first by default.
  const raw = (
    process.env.ADS_USE_SANDBOX ??
    process.env.AMAZON_USE_SANDBOX ??
    'true'
  )
    .trim()
    .toLowerCase();
  return raw !== 'false';
}

/**
 * Resolve Advertising API config from env. Throws a clear, actionable error if
 * any required variable is missing. Call this lazily (at request time), not at
 * import time.
 */
export function getAdsConfig(): AdsConfig {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Amazon Advertising API config missing required env var(s): ${missing.join(
        ', ',
      )}. Set them in the server environment (.env.local / Vercel project env).`,
    );
  }

  const useSandbox = readUseSandbox();
  const host = useSandbox ? SANDBOX_HOST : PROD_HOST;

  return {
    clientId: process.env.ADS_CLIENT_ID!.trim(),
    clientSecret: process.env.ADS_CLIENT_SECRET!.trim(),
    refreshToken: process.env.ADS_REFRESH_TOKEN!.trim(),
    profileId: process.env.ADS_PROFILE_ID!.trim(),
    useSandbox,
    host,
  };
}
