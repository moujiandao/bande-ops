/**
 * DemandProvider — the seam that supplies a SKU's average daily demand to the
 * reorder math, decoupled from where the number comes from.
 *
 * PII boundary (non-negotiable): demand is the AGGREGATE units shipped from the
 * FBA INVENTORY LEDGER report, NOT Orders / buyer data. The ledger is a
 * movements report (units in/out per SKU per day); summing "units shipped" over
 * a window and dividing by the window length gives average daily demand with no
 * buyer PII and no Restricted Data Token. See CLAUDE.md "Do Not" (no Orders/PII).
 *
 * UNKNOWN demand convention: when there is no usable demand window for a SKU,
 * the provider returns `null` (UNKNOWN) — NEVER 0. The recommender surfaces a
 * null-demand SKU as needs-review; a 0 would silently read as "no demand" and
 * skew the reorder point. Same discipline as UNKNOWN on-hand.
 *
 * FILE LAYOUT (mirrors lib/amazon): this file is the BARREL + factory. The real
 * SP-API provider lives in `./spapi-demand` (which `import 'server-only'`), so
 * importing this barrel is server-only too — only the server page does it. The
 * Fake lives in `./fake-demand` (node-safe), so tests import IT directly, never
 * this barrel. service.ts depends only on the `DemandProvider` *type* from here
 * (an erased `import type`), so it stays loadable in node unit tests.
 */

import type { MarketplaceId } from '@/lib/amazon/types';
import { FakeDemandProvider } from './fake-demand';
import { SpApiDemandProvider } from './spapi-demand';

/**
 * Supplies average daily demand (units/day) for a SKU in a marketplace.
 * Returns `null` when demand is UNKNOWN (no usable window) — never 0.
 */
export interface DemandProvider {
  getDailyDemand(sku: string, marketplaceId: MarketplaceId): Promise<number | null>;
}

export { FakeDemandProvider } from './fake-demand';
export { SpApiDemandProvider } from './spapi-demand';

/**
 * Factory for the app's DemandProvider, mirroring `getAmazonClient()`.
 *
 * Returns FakeDemandProvider when AMAZON_USE_FAKE === 'true' (local dev / tests
 * without creds), otherwise the real SpApiDemandProvider skeleton.
 */
export function getDemandProvider(): DemandProvider {
  if (process.env.AMAZON_USE_FAKE === 'true') {
    return new FakeDemandProvider();
  }
  return new SpApiDemandProvider();
}
