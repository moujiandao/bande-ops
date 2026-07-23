import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./config', () => ({
  getAdsConfig: vi.fn(() => ({
    clientId: 'ads-client-id',
    clientSecret: 'ads-client-secret',
    refreshToken: 'ads-refresh-token',
    profileId: 'profile-1',
    useSandbox: true,
    host: 'ads.test',
  })),
}));

import { AdsApiClient } from './client';

/** LWA token response, served for the token exchange that precedes each call. */
function tokenResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: 'ads-access-token', expires_in: 3600 }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Route the token exchange vs. the Advertising API call by URL. */
function routed(apiResponses: Response[]): ReturnType<typeof vi.fn> {
  const queue = [...apiResponses];
  return vi.fn((url: string | URL) => {
    if (String(url).includes('api.amazon.com')) {
      return Promise.resolve(tokenResponse());
    }
    return Promise.resolve(queue.shift() ?? response({ campaigns: [] }));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdsApiClient', () => {
  it('sends a descriptive User-Agent to the Advertising API', async () => {
    const fetchMock = routed([response({ campaigns: [] })]);
    vi.stubGlobal('fetch', fetchMock);

    await new AdsApiClient().listCampaigns();

    const apiCall = fetchMock.mock.calls.find(
      (call) => !String(call[0]).includes('api.amazon.com'),
    ) as [string, RequestInit];
    const headers = apiCall[1].headers as Record<string, string>;
    expect(headers['user-agent']).toMatch(/^bande-ops\/\d+\.\d+\.\d+ /);
  });

  it('gives up after MAX_RETRIES and throws rather than swallowing the failure', async () => {
    const fetchMock = vi.fn((url: string | URL) => {
      if (String(url).includes('api.amazon.com')) {
        return Promise.resolve(tokenResponse());
      }
      // retry-after: 0 keeps the waits instant while still exercising the loop.
      return Promise.resolve(
        new Response('still throttled', {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(new AdsApiClient().listCampaigns()).rejects.toThrow(/429/);

    const apiCalls = fetchMock.mock.calls.filter(
      (call) => !String(call[0]).includes('api.amazon.com'),
    );
    // One initial attempt plus MAX_RETRIES (3) retries.
    expect(apiCalls).toHaveLength(4);
  });

  it('waits the Retry-After interval before retrying a throttled request', async () => {
    const throttled = new Response('slow down', {
      status: 429,
      headers: { 'retry-after': '2' },
    });
    const fetchMock = routed([throttled, response({ campaigns: [] })]);
    const delays: number[] = [];
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    try {
      const pending = new AdsApiClient({
        onRetryDelay: (ms) => delays.push(ms),
      }).listCampaigns();
      await vi.advanceTimersByTimeAsync(2000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    expect(delays).toEqual([2000]);
  });
});
