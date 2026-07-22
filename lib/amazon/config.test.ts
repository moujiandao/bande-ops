import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getAmazonConfig } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getAmazonConfig', () => {
  it('requires SPAPI_SELLER_ID for live SP-API calls', () => {
    vi.stubEnv('LWA_CLIENT_ID', 'client-id');
    vi.stubEnv('LWA_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('SPAPI_REFRESH_TOKEN', 'refresh-token');
    vi.stubEnv('AMAZON_USE_SANDBOX', 'false');
    vi.stubEnv('SPAPI_SELLER_ID', '');

    expect(() => getAmazonConfig()).toThrow(/SPAPI_SELLER_ID/);
  });
});
