import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { describeDataSourceMode, getDataSourceMode } from './mode';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getDataSourceMode', () => {
  it('reports fake for both APIs when AMAZON_USE_FAKE is on', () => {
    vi.stubEnv('AMAZON_USE_FAKE', 'true');
    vi.stubEnv('AMAZON_USE_SANDBOX', 'false');

    const mode = getDataSourceMode();

    // The fake client short-circuits before any host or sandbox flag matters.
    expect(mode.amazon).toBe('fake');
    expect(mode.ads).toBe('fake');
  });

  it('defaults to sandbox when the sandbox flag is unset', () => {
    vi.stubEnv('AMAZON_USE_FAKE', '');
    vi.stubEnv('AMAZON_USE_SANDBOX', '');
    vi.stubEnv('ADS_USE_SANDBOX', '');

    const mode = getDataSourceMode();

    expect(mode.amazon).toBe('sandbox');
    expect(mode.ads).toBe('sandbox');
  });

  it('reports production only when fake is off and sandbox is explicitly false', () => {
    vi.stubEnv('AMAZON_USE_FAKE', 'false');
    vi.stubEnv('AMAZON_USE_SANDBOX', 'false');
    vi.stubEnv('ADS_USE_SANDBOX', 'false');

    const mode = getDataSourceMode();

    expect(mode.amazon).toBe('production');
    expect(mode.ads).toBe('production');
  });

  it('lets Ads reach production while SP-API stays in sandbox', () => {
    vi.stubEnv('AMAZON_USE_FAKE', 'false');
    vi.stubEnv('AMAZON_USE_SANDBOX', 'true');
    vi.stubEnv('ADS_USE_SANDBOX', 'false');

    const mode = getDataSourceMode();

    expect(mode.amazon).toBe('sandbox');
    expect(mode.ads).toBe('production');
  });

  it('flags a production deploy that is not serving live data', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('AMAZON_USE_FAKE', 'true');

    const mode = getDataSourceMode();

    expect(mode.isProductionDeploy).toBe(true);
    expect(mode.isMisconfigured).toBe(true);
  });

  it('does not flag a preview deploy running on fakes', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('AMAZON_USE_FAKE', 'true');

    const mode = getDataSourceMode();

    expect(mode.isProductionDeploy).toBe(false);
    expect(mode.isMisconfigured).toBe(false);
  });

  it('does not flag a production deploy that is fully live', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('AMAZON_USE_FAKE', 'false');
    vi.stubEnv('AMAZON_USE_SANDBOX', 'false');
    vi.stubEnv('ADS_USE_SANDBOX', 'false');

    const mode = getDataSourceMode();

    expect(mode.isMisconfigured).toBe(false);
  });
});

describe('describeDataSourceMode', () => {
  it('names both APIs when they disagree', () => {
    vi.stubEnv('AMAZON_USE_FAKE', 'false');
    vi.stubEnv('AMAZON_USE_SANDBOX', 'true');
    vi.stubEnv('ADS_USE_SANDBOX', 'false');

    expect(describeDataSourceMode(getDataSourceMode())).toBe(
      'SP-API: sandbox · Ads: production',
    );
  });

  it('collapses to a single label when both agree', () => {
    vi.stubEnv('AMAZON_USE_FAKE', 'true');

    expect(describeDataSourceMode(getDataSourceMode())).toBe('Fake data');
  });
});
