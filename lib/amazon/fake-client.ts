import {
  DEFAULT_MARKETPLACE,
  type CatalogItem,
  type InventorySummary,
} from './types';
import type {
  AmazonClient,
  GetInventorySummariesOptions,
  ListCatalogItemsOptions,
} from './client';

/**
 * Deterministic, network-free AmazonClient for tests and local dev.
 *
 * Returns small canned data. One inventory row has totalQuantity: null to
 * exercise the UNKNOWN-stock path (must never be treated as 0).
 */
export class FakeAmazonClient implements AmazonClient {
  private readonly catalog: CatalogItem[];
  private readonly inventory: InventorySummary[];

  constructor(seed?: {
    catalog?: CatalogItem[];
    inventory?: InventorySummary[];
  }) {
    const marketplaceId = DEFAULT_MARKETPLACE.id;

    this.catalog = seed?.catalog ?? [
      {
        sku: 'BANDE-001',
        asin: 'B0000000A1',
        title: 'Bande Test Widget A',
        imageUrl: 'https://example.invalid/a1.jpg',
      },
      {
        sku: 'BANDE-002',
        asin: 'B0000000B2',
        title: 'Bande Test Widget B',
      },
    ];

    this.inventory = seed?.inventory ?? [
      {
        sku: 'BANDE-001',
        marketplaceId,
        totalQuantity: 42,
        fnSku: 'X000111AAA',
      },
      {
        // UNKNOWN stock: Amazon reported non-numeric/unavailable.
        sku: 'BANDE-002',
        marketplaceId,
        totalQuantity: null,
      },
    ];
  }

  async listCatalogItems(
    _opts: ListCatalogItemsOptions = {},
  ): Promise<CatalogItem[]> {
    return this.catalog;
  }

  async getInventorySummaries(
    _opts: GetInventorySummariesOptions = {},
  ): Promise<InventorySummary[]> {
    return this.inventory;
  }
}
