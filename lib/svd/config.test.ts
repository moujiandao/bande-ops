import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getSvdConfig } from './config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSvdConfig', () => {
  it('normalizes a pasted full login URL down to its origin', () => {
    // The login URL a user copies out of the browser carries a path, a stale
    // session id and a query string. The client builds its own paths, so
    // anything past the origin would produce a doubled URL and a 404.
    vi.stubEnv('SVD_USERNAME', 'user');
    vi.stubEnv('SVD_PASSWORD', 'pass');
    vi.stubEnv(
      'SVD_BASE_URL',
      'https://svdirect.us/sv5fmsnet/OeCart/OeFrame.asp?PmSess1=4114&Action=LOGIN&pos=MBasic',
    );

    expect(getSvdConfig().baseUrl).toBe('https://svdirect.us');
  });

  it('accepts a bare origin unchanged and strips a trailing slash', () => {
    vi.stubEnv('SVD_USERNAME', 'user');
    vi.stubEnv('SVD_PASSWORD', 'pass');
    vi.stubEnv('SVD_BASE_URL', 'https://svdirect.us/');

    expect(getSvdConfig().baseUrl).toBe('https://svdirect.us');
  });

  it('falls back to the default host when unset', () => {
    vi.stubEnv('SVD_USERNAME', 'user');
    vi.stubEnv('SVD_PASSWORD', 'pass');
    vi.stubEnv('SVD_BASE_URL', '');

    expect(getSvdConfig().baseUrl).toBe('https://svdirect.us');
  });

  it('throws naming the missing variable, never its value', () => {
    vi.stubEnv('SVD_USERNAME', '');
    vi.stubEnv('SVD_PASSWORD', 'pass');

    expect(() => getSvdConfig()).toThrow(/SVD_USERNAME/);
  });
});
