import 'server-only';

import { getAmazonConfig } from './config';

/**
 * Login with Amazon (LWA) token exchange.
 *
 * Exchanges the long-lived refresh_token for a short-lived access_token, caches
 * it in-memory, and refreshes ~60s before expiry. Server-only.
 */

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** Refresh this many ms before the real expiry to avoid edge-of-expiry races. */
const EXPIRY_SKEW_MS = 60_000;

interface CachedToken {
  accessToken: string;
  /** Absolute epoch ms at which we consider the token expired (skew applied). */
  expiresAt: number;
}

interface LwaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

let cached: CachedToken | null = null;
/** Coalesce concurrent refreshes so we don't hammer LWA on a cold cache. */
let inFlight: Promise<string> | null = null;

function isFresh(token: CachedToken | null): token is CachedToken {
  return token !== null && Date.now() < token.expiresAt;
}

async function fetchAccessToken(): Promise<string> {
  const config = getAmazonConfig();

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    client_id: config.lwaClientId,
    client_secret: config.lwaClientSecret,
  });

  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `LWA token exchange failed: ${res.status} ${res.statusText}${
        detail ? ` — ${detail}` : ''
      }`,
    );
  }

  const json = (await res.json()) as LwaTokenResponse;
  if (!json.access_token) {
    throw new Error('LWA token exchange returned no access_token.');
  }

  cached = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000 - EXPIRY_SKEW_MS,
  };
  return cached.accessToken;
}

/**
 * Return a valid LWA access token, refreshing from cache when stale.
 * Concurrent callers share a single in-flight refresh.
 */
export async function getAccessToken(): Promise<string> {
  if (isFresh(cached)) {
    return cached.accessToken;
  }
  if (inFlight) {
    return inFlight;
  }
  inFlight = fetchAccessToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Test/util hook: drop the cached token. */
export function __resetTokenCache(): void {
  cached = null;
  inFlight = null;
}
