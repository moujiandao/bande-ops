import 'server-only';

/**
 * Which data each Amazon-backed client is actually serving.
 *
 * The flip to real data is three flags across two APIs, and every one of them
 * fails *quietly*: `AMAZON_USE_FAKE` swaps in the fake client, and the sandbox
 * hosts return Amazon's canned fixtures. A deploy in either state looks
 * completely healthy — pages render, syncs succeed, numbers appear — while the
 * numbers are fiction. This module makes the mode explicit so the UI can say so
 * out loud (issue #28).
 *
 * Mirrors the resolution order in `lib/amazon/index.ts`, `lib/amazon/config.ts`,
 * and `lib/ads/config.ts`. Kept in one place so the banner cannot disagree with
 * the clients about what is live.
 */

export type SourceMode = 'fake' | 'sandbox' | 'production';

export interface DataSourceMode {
  /** SP-API: catalog, FBA/AWD inventory, ledger velocity. */
  amazon: SourceMode;
  /** Advertising API — separate creds and its own sandbox switch. */
  ads: SourceMode;
  /** True on a Vercel production deploy (not preview, not local dev). */
  isProductionDeploy: boolean;
  /** A production deploy not serving fully live data — the #28 footgun. */
  isMisconfigured: boolean;
}

function isFake(): boolean {
  // Must match getAmazonClient/getAdsClient exactly: strict 'true', nothing else.
  return process.env.AMAZON_USE_FAKE === 'true';
}

/** Sandbox-first: anything other than an explicit 'false' means sandbox. */
function isSandbox(raw: string | undefined, fallback: string | undefined): boolean {
  const value = (raw?.trim() || fallback?.trim() || 'true').toLowerCase();
  return value !== 'false';
}

export function getDataSourceMode(): DataSourceMode {
  const fake = isFake();
  const sharedSandbox = process.env.AMAZON_USE_SANDBOX;

  const amazon: SourceMode = fake
    ? 'fake'
    : isSandbox(sharedSandbox, undefined)
      ? 'sandbox'
      : 'production';

  // Ads can be promoted independently, falling back to the shared flag.
  const ads: SourceMode = fake
    ? 'fake'
    : isSandbox(process.env.ADS_USE_SANDBOX, sharedSandbox)
      ? 'sandbox'
      : 'production';

  const isProductionDeploy = process.env.VERCEL_ENV === 'production';

  return {
    amazon,
    ads,
    isProductionDeploy,
    isMisconfigured:
      isProductionDeploy && (amazon !== 'production' || ads !== 'production'),
  };
}

const LABELS: Record<SourceMode, string> = {
  fake: 'Fake data',
  sandbox: 'sandbox',
  production: 'production',
};

/** Human-readable summary, naming each API only when the two disagree. */
export function describeDataSourceMode(mode: DataSourceMode): string {
  if (mode.amazon === mode.ads) return LABELS[mode.amazon];
  return `SP-API: ${LABELS[mode.amazon]} · Ads: ${LABELS[mode.ads]}`;
}
