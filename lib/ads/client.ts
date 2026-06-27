import 'server-only';

import { getAdsConfig } from './config';
import type { Campaign, CampaignMetrics, CampaignState } from './types';
import { parseV3Campaign } from './v3';

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
  /**
   * Fetch performance metrics (impressions/clicks/cost/sales) for all campaigns
   * over a reporting window, in ONE batched async report (never per-campaign).
   * Missing metrics MUST come back as null (UNKNOWN), never fabricated 0s.
   */
  getCampaignMetrics(opts?: GetCampaignMetricsOptions): Promise<CampaignMetrics[]>;
  /**
   * Write a change back to a single Sponsored Products campaign — the FIRST and
   * only write-back in the app. Can pause/enable a campaign and/or change its
   * daily budget, i.e. it stops ads or changes spend, so it is always
   * user-initiated, owner-gated, confirmed, and audited at the call site
   * (`app/(app)/ads/write-actions.ts`); this seam only performs the write.
   *
   * At least one of `state` / `dailyBudget` must be supplied. Resolves on
   * success; rejects (never silently no-ops) on failure so a caller cannot
   * mistake a no-op for an applied change.
   */
  updateCampaign(input: UpdateCampaignInput): Promise<void>;
}

/** A single-campaign write. At least one mutable field must be present. */
export interface UpdateCampaignInput {
  campaignId: string;
  /** New lifecycle state (e.g. 'paused' to stop the campaign). */
  state?: CampaignState;
  /** New daily budget (currency amount, > 0). */
  dailyBudget?: number;
}

/** Options for {@link AdsClient.getCampaignMetrics}. */
export interface GetCampaignMetricsOptions {
  /** Inclusive report start date, 'YYYY-MM-DD'. Defaults to a recent window. */
  startDate?: string;
  /** Inclusive report end date, 'YYYY-MM-DD'. Defaults to today. */
  endDate?: string;
}

/** Retry tuning for transient Advertising API failures (429 / 5xx). */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

// LWA token exchange endpoint (same as SP-API uses; the creds differ).
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
/** Refresh this many ms before real expiry to avoid edge-of-expiry races. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * LWA scope requested at token exchange for the Advertising API. The campaign
 * management scope is what the v3 Sponsored Products endpoints require.
 */
const ADS_LWA_SCOPE = 'advertising::campaign_management';

/**
 * Vendored (per-endpoint) media type for the Sponsored Products v3 campaigns
 * list endpoint, sent as BOTH Content-Type and Accept. v3 replaces the generic
 * application/json of v2 with these versioned, resource-scoped media types.
 */
const SP_CAMPAIGN_V3_MEDIA_TYPE = 'application/vnd.spCampaign.v3+json';

/** How many campaigns to request per page on the v3 list endpoint. */
const LIST_PAGE_SIZE = 100;

/**
 * Budget type for a v3 Sponsored Products campaign budget object. Only DAILY is
 * exercised here (the only budget the app edits).
 */
const SP_BUDGET_TYPE_DAILY = 'DAILY';

/**
 * Vendored media type for CREATING a v3 async report (POST /reporting/reports).
 * Sent as BOTH Content-Type and Accept on the create call.
 */
const CREATE_ASYNC_REPORT_MEDIA_TYPE =
  'application/vnd.createasyncreportrequest.v3+json';

/** Report type for the Sponsored Products campaign-level performance report. */
const SP_CAMPAIGNS_REPORT_TYPE_ID = 'spCampaigns';

/**
 * v3 report columns we request. cost is ad spend; sales is the attribution-
 * windowed attributed sales. ACOS/ROAS are NOT columns — Amazon never returns
 * them; we compute them ourselves (see metrics.ts). campaignId is the join key.
 */
const SP_CAMPAIGNS_REPORT_COLUMNS = [
  'campaignId',
  'impressions',
  'clicks',
  'cost',
  'sales1d', // attribution-windowed attributed sales; verify column id vs sandbox
] as const;

/** Terminal states of an async report. */
const REPORT_STATUS_COMPLETED = 'COMPLETED';
const REPORT_STATUS_FAILURE = 'FAILURE';
const REPORT_STATUS_CANCELLED = 'CANCELLED';

/** Poll tuning for the async report status loop. */
const REPORT_POLL_INTERVAL_MS = 5_000;
const REPORT_POLL_MAX_ATTEMPTS = 60; // ~5 min ceiling

interface RequestOptions {
  method?: string;
  /** Path beginning with '/', appended to the Advertising API host. */
  path: string;
  query?: Record<string, string | string[] | undefined>;
  /** JSON body for POST/PUT requests; serialized with JSON.stringify. */
  body?: unknown;
  /**
   * Per-call vendored media type, sent as BOTH Content-Type and Accept. When
   * omitted, defaults to Accept: application/json (no Content-Type).
   */
  mediaType?: string;
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
      // Request the campaign-management scope the v3 SP endpoints require.
      scope: ADS_LWA_SCOPE,
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
    const method = opts.method ?? 'GET';
    const hasBody = opts.body !== undefined;
    const serializedBody = hasBody ? JSON.stringify(opts.body) : undefined;

    // Per-call vendored media type (v3) governs BOTH Accept and Content-Type;
    // fall back to plain JSON when no media type is supplied.
    const accept = opts.mediaType ?? 'application/json';

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Refresh token each attempt in case a long backoff outlived the token.
      const accessToken = await this.getAccessToken();

      const headers: Record<string, string> = {
        authorization: `Bearer ${accessToken}`,
        'Amazon-Advertising-API-ClientId': config.clientId,
        'Amazon-Advertising-API-Scope': config.profileId,
        accept,
      };
      // Only set Content-Type when we actually send a body.
      if (hasBody) {
        headers['content-type'] = opts.mediaType ?? 'application/json';
      }

      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: serializedBody,
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
        `Ads API ${method} ${opts.path} failed: ${res.status} ${
          res.statusText
        }${detail ? ` — ${detail}` : ''}`,
      );
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Ads API request failed after retries.');
  }

  async listCampaigns(): Promise<Campaign[]> {
    // Sponsored Products v3: POST /sp/campaigns/list with the vendored media
    // type, paginating via nextToken until exhausted. Each raw v3 campaign is
    // normalized through the pure parseV3Campaign mapper.
    // TODO: verify against sandbox.
    const campaigns: Campaign[] = [];
    let nextToken: string | undefined;

    do {
      const page = await this.request<V3CampaignListResponse>({
        method: 'POST',
        path: '/sp/campaigns/list',
        mediaType: SP_CAMPAIGN_V3_MEDIA_TYPE,
        body: {
          maxResults: LIST_PAGE_SIZE,
          stateFilter: { include: ['ENABLED', 'PAUSED', 'ARCHIVED'] },
          ...(nextToken ? { nextToken } : {}),
        },
      });

      for (const raw of page?.campaigns ?? []) {
        campaigns.push(parseV3Campaign(raw));
      }
      nextToken = page?.nextToken;
    } while (nextToken);

    return campaigns;
  }

  /**
   * Real v3 reporting flow for campaign performance metrics — documented
   * skeleton. The shape below is the production path; the live network +
   * gunzip + parse leg is gated on sandbox verification (creds + a gzip
   * download primitive), so today it throws rather than fabricating data.
   *
   * BATCHED, never per-campaign: one async report covers ALL campaigns at once
   * (like the FBA ledger pull). Per-campaign report requests are explicitly
   * wrong here — they would N-multiply the report quota and miss the batched
   * attribution model.
   *
   * Flow (TODO: verify against sandbox):
   *   1. POST /reporting/reports with Content-Type
   *      `application/vnd.createasyncreportrequest.v3+json`, body carrying
   *      reportTypeId 'spCampaigns', a {startDate,endDate} range, groupBy
   *      ['campaign'], the columns (campaignId, impressions, clicks, cost,
   *      sales*), and format 'GZIP_JSON'. Returns a reportId.
   *   2. Poll GET /reporting/reports/{reportId} until status COMPLETED; bail
   *      loudly on FAILURE / CANCELLED (never return partial/fabricated rows).
   *   3. Download the GZIP from the returned `url`, gunzip, and JSON-parse.
   *   4. Map each row -> CampaignMetrics with absent metrics as null (UNKNOWN),
   *      NEVER 0. ACOS/ROAS stay computed downstream.
   */
  async getCampaignMetrics(
    _opts?: GetCampaignMetricsOptions,
  ): Promise<CampaignMetrics[]> {
    // Reference the report contract so it is type-checked even while gated.
    void {
      mediaType: CREATE_ASYNC_REPORT_MEDIA_TYPE,
      reportTypeId: SP_CAMPAIGNS_REPORT_TYPE_ID,
      columns: SP_CAMPAIGNS_REPORT_COLUMNS,
      groupBy: ['campaign'],
      format: 'GZIP_JSON',
      pollIntervalMs: REPORT_POLL_INTERVAL_MS,
      pollMaxAttempts: REPORT_POLL_MAX_ATTEMPTS,
      terminal: [
        REPORT_STATUS_COMPLETED,
        REPORT_STATUS_FAILURE,
        REPORT_STATUS_CANCELLED,
      ],
    };

    // TODO(creds): implement the create -> poll -> download(gunzip) -> parse
    // flow above once Advertising API creds + a gzip download primitive are
    // available and verified against the sandbox. Until then this is a hard
    // skeleton: it MUST NOT silently return [] or fabricated 0s (either would
    // read as "no spend / no sales" and corrupt ACOS/ROAS). Throw so a
    // mis-wired production path fails loud.
    throw new Error(
      'AdsApiClient.getCampaignMetrics: not implemented (gated on Advertising ' +
        'API creds + sandbox-verified v3 async reporting). Set ' +
        'AMAZON_USE_FAKE=true to use FakeAdsClient.',
    );
  }

  /**
   * Real v3 Sponsored Products campaign WRITE — documented skeleton.
   *
   * This is the highest-risk call in the app: it can pause/enable a campaign and
   * change its daily budget (stop ads / change spend). The production path is a
   *   PUT /sp/campaigns
   * with Content-Type/Accept `application/vnd.spCampaign.v3+json` and the
   * ClientId + Scope (profile) headers (all carried by `request()`), body:
   *   { campaigns: [{ campaignId, state?, budget?: { budget, budgetType } }] }
   * where our lowercase CampaignState maps to Amazon's uppercase enum and the
   * daily budget maps to a DAILY budget object.
   *
   * The live network leg is GATED on sandbox verification — a wrong write here
   * changes real spend. Until verified it MUST NOT silently no-op (that would
   * read as "applied" while nothing changed). It validates the input, builds the
   * exact request (type-checked below), then throws loud. // TODO(creds): verify
   * the endpoint/method/body against the sandbox, then send via `this.request`.
   */
  async updateCampaign(input: UpdateCampaignInput): Promise<void> {
    if (input.state === undefined && input.dailyBudget === undefined) {
      throw new Error(
        'AdsApiClient.updateCampaign: nothing to change (provide state and/or dailyBudget).',
      );
    }

    // Build the v3 update payload for ONE campaign. Map our lowercase state to
    // Amazon's uppercase enum; map dailyBudget to a DAILY budget object.
    const campaignUpdate: Record<string, unknown> = {
      campaignId: input.campaignId,
    };
    if (input.state !== undefined) {
      campaignUpdate.state = input.state.toUpperCase();
    }
    if (input.dailyBudget !== undefined) {
      campaignUpdate.budget = {
        budget: input.dailyBudget,
        budgetType: SP_BUDGET_TYPE_DAILY,
      };
    }

    // Reference the exact request contract so it stays type-checked while gated.
    // TODO(creds): replace this `void` with `await this.request(...)` once the
    // write is verified against the sandbox.
    void ({
      method: 'PUT',
      path: '/sp/campaigns',
      mediaType: SP_CAMPAIGN_V3_MEDIA_TYPE,
      body: { campaigns: [campaignUpdate] },
    } satisfies RequestOptions);

    throw new Error(
      'AdsApiClient.updateCampaign: not implemented (gated on sandbox-verified ' +
        'v3 Sponsored Products write — a real write changes live spend). Set ' +
        'AMAZON_USE_FAKE=true to use FakeAdsClient.',
    );
  }
}

// --- Sponsored Products v3 raw response shapes (partial; only what we map) ---

/** A single page of the v3 POST /sp/campaigns/list response. */
interface V3CampaignListResponse {
  campaigns?: unknown[];
  /** Present only while more pages remain. */
  nextToken?: string;
}
