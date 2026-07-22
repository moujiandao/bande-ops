/**
 * Public surface of the server-only Amazon SP-API client.
 *
 * Modules import from here. The AmazonClient interface is the single test seam:
 * inject FakeAmazonClient in tests, get SpApiClient in production.
 */

export type {
  MarketplaceId,
  Marketplace,
  CatalogItem,
  InventorySummary,
  AwdInventorySummary,
} from './types';
export { MARKETPLACES, DEFAULT_MARKETPLACE } from './types';

export type {
  AmazonClient,
  ListCatalogItemsOptions,
  GetInventorySummariesOptions,
  ListAwdInventoryOptions,
} from './client';
export { SpApiClient } from './client';
export { FakeAmazonClient } from './fake-client';

import type { AmazonClient } from './client';
import { SpApiClient } from './client';
import { FakeAmazonClient } from './fake-client';

/**
 * Factory for the app's AmazonClient.
 *
 * Returns FakeAmazonClient when AMAZON_USE_FAKE === 'true' (local dev / tests
 * without creds), otherwise the real SpApiClient. No network at construction.
 */
export function getAmazonClient(): AmazonClient {
  if (process.env.AMAZON_USE_FAKE === 'true') {
    return new FakeAmazonClient();
  }
  return new SpApiClient();
}
