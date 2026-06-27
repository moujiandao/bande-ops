/**
 * Public surface of the server-only Amazon Advertising API client.
 *
 * Modules import from here. The AdsClient interface is the single test seam:
 * inject FakeAdsClient in tests, get AdsApiClient in production.
 */

export {
  type MarketplaceId,
  type Marketplace,
  type CampaignState,
  type Campaign,
  type AdsCampaignRow,
  MARKETPLACES,
  DEFAULT_MARKETPLACE,
} from './types';

export type { AdsClient } from './client';
export { AdsApiClient } from './client';
export { FakeAdsClient } from './fake-client';

import type { AdsClient } from './client';
import { AdsApiClient } from './client';
import { FakeAdsClient } from './fake-client';

/**
 * Factory for the app's AdsClient.
 *
 * Returns FakeAdsClient when AMAZON_USE_FAKE === 'true' (local dev / tests
 * without creds), otherwise the real AdsApiClient. No network at construction.
 */
export function getAdsClient(): AdsClient {
  if (process.env.AMAZON_USE_FAKE === 'true') {
    return new FakeAdsClient();
  }
  return new AdsApiClient();
}
