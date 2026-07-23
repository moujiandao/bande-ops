import 'server-only';

import { readUseSandbox as readAdsUseSandbox } from '../ads/config';
import { readUseSandbox as readAmazonUseSandbox } from '../amazon/config';

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
 * Delegates to each client's own `readUseSandbox()` rather than restating the
 * flag precedence, because the two chains genuinely differ (SP-API reads one
 * flag; Ads falls back through `??`, where an empty-but-set value still counts).
 * A banner that disagrees with the clients is worse than no banner.
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

export function getDataSourceMode(): DataSourceMode {
  const fake = isFake();

  // Call each client's own sandbox resolver rather than reimplementing the
  // precedence. These are cheap, throw nothing, and read no credentials — the
  // throwing parts of getAmazonConfig/getAdsConfig are deliberately not used.
  const amazon: SourceMode = fake
    ? 'fake'
    : readAmazonUseSandbox()
      ? 'sandbox'
      : 'production';

  // Ads can be promoted independently; its resolver owns that fallback chain.
  const ads: SourceMode = fake
    ? 'fake'
    : readAdsUseSandbox()
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
