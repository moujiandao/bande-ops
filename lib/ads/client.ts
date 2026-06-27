import 'server-only';

import { getAdsConfig } from './config';
import type { Campaign, CampaignState } from './types';

/**
 * The single test seam for the Ads module.
 *
 * AdsClient is a deep module: a tiny, well-typed interface that hides the whole
 * Advertising API surface — LWA auth, the profile-scoped headers, host routing,
 * and retry/backoff. Modules depend on this interface; tests inject
 * FakeAdsClient.
 */
export interface AdsClient {
  listCampaigns(): Promise<Campaign[]>;
}

/** Retry tuning for transient Advertising API failures (429 / 5xx). */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

// LWA token exchange endpoint (same as SP-API uses; the creds differ).
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
/** Refresh this many ms before real expiry to avoid edge-of-expiry races. */
const EXPIRY_SKEW_MS = 60_000;

interface RequestOptions {
  method?: string;
  /** Path beginning with '/', appended to the Advertising API host. */
  path: string;
  query?: Record<string, string | string[] | undefined>;
}

interface CachedToken {
  accessToken: string;
  /** Absolute epoch ms at which we consider the token expired (skew applied). */
  expiresAt: number;
}

interface LwaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

function buildUrl(
  host: string,
  path: string,
  query?: RequestOptions['query'],
): string {
  const url = new URL(`https://${host}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : value);
    }
  }
  return url.toString();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter, capped. */
function backoffDelay(attempt: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Coerce a possibly-non-numeric Advertising daily budget into number | null.
 * UNKNOWN (non-numeric/unavailable) maps to null, never 0.
 */
function toBudget(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}

function toCampaignState(raw: unknown): CampaignState {
  // Advertising API returns lowercase enabled/paused/archived; default unknown
  // values to 'paused' (the safe, non-spending state) rather than guessing.
  return raw === 'enabled' || raw === 'archived' ? raw : 'paused';
}

export class AdsApiClient implements AdsClient {
  private cachedToken: CachedToken | null = null;
  /** Coalesce concurrent refreshes so we don't hammer LWA on a cold cache. */
  private inFlightToken: Promise<string> | null = null;

  private isFresh(token: CachedToken | null): token is CachedToken {
    return token !== null && Date.now() < token.expiresAt;
  }

  /**
   * Return a valid LWA access token, refreshing from cache when stale.
   * Concurrent callers share a single in-flight refresh.
   */
  private async getAccessToken(): Promise<string> {
    if (this.isFresh(this.cachedToken)) {
      return this.cachedToken.accessToken;
    }
    if (this.inFlightToken) {
      return this.inFlightToken;
    }
    this.inFlightToken = this.fetchAccessToken().finally(() => {
      this.inFlightToken = null;
    });
    return this.inFlightToken;
  }

  private async fetchAccessToken(): Promise<string> {
    const config = getAdsConfig();

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
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
        `Ads LWA token exchange failed: ${res.status} ${res.statusText}${
          detail ? ` — ${detail}` : ''
        }`,
      );
    }

    const json = (await res.json()) as LwaTokenResponse;
    if (!json.access_token) {
      throw new Error('Ads LWA token exchange returned no access_token.');
    }

    this.cachedToken = {
      accessToken: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000 - EXPIRY_SKEW_MS,
    };
    return this.cachedToken.accessToken;
  }

  /**
   * Profile-scoped, retrying request against the Advertising API host. Every
   * request carries Authorization: Bearer + the Amazon-Advertising-API-ClientId
   * and Amazon-Advertising-API-Scope (profile id) headers.
   */
  private async request<T>(opts: RequestOptions): Promise<T> {
    const config = getAdsConfig();
    const url = buildUrl(config.host, opts.path, opts.query);

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Refresh token each attempt in case a long backoff outlived the token.
      const accessToken = await this.getAccessToken();

      let res: Response;
      try {
        res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'Amazon-Advertising-API-ClientId': config.clientId,
            'Amazon-Advertising-API-Scope': config.profileId,
            accept: 'application/json',
          },
          cache: 'no-store',
        });
      } catch (err) {
        // Network/transport error: retry while attempts remain.
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw err;
      }

      if (res.ok) {
        return (await res.json()) as T;
      }

      // Transient HTTP failure: back off and retry.
      if (isRetryable(res.status) && attempt < MAX_RETRIES) {
        await sleep(backoffDelay(attempt));
        continue;
      }

      // Non-retryable (4xx) or out of retries: fail without re-looping.
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Ads API ${opts.method ?? 'GET'} ${opts.path} failed: ${res.status} ${
          res.statusText
        }${detail ? ` — ${detail}` : ''}`,
      );
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Ads API request failed after retries.');
  }

  async listCampaigns(): Promise<Campaign[]> {
    // Sponsored Products campaigns (v2). TODO: verify against sandbox.
    const data = await this.request<RawCampaign[]>({
      path: '/v2/sp/campaigns',
    });

    return (data ?? []).map(mapCampaign);
  }
}

// --- Advertising API raw response shapes (partial; only what we map) ---

interface RawCampaign {
  campaignId?: number | string;
  name?: string;
  state?: string;
  dailyBudget?: unknown;
}

function mapCampaign(raw: RawCampaign): Campaign {
  return {
    campaignId: raw.campaignId != null ? String(raw.campaignId) : '',
    name: raw.name ?? '',
    state: toCampaignState(raw.state),
    dailyBudget: toBudget(raw.dailyBudget),
  };
}
