import {
  DEFAULT_MARKETPLACE,
  type CatalogItem,
  type AwdInventorySummary,
  type InventorySummary,
} from './types';
import type {
  AmazonClient,
  CompletedReport,
  CreateLedgerReportOptions,
  DownloadReportDocumentOptions,
  GetInventorySummariesOptions,
  GetReportUntilDoneOptions,
  ListAwdInventoryOptions,
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
  private readonly awdInventory: AwdInventorySummary[];

  constructor(seed?: {
    catalog?: CatalogItem[];
    inventory?: InventorySummary[];
    awdInventory?: AwdInventorySummary[];
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
        fulfillableQuantity: 42,
        inboundShippedQuantity: 10,
        inboundReceivingQuantity: 5,
        inboundWorkingQuantity: 0,
        reservedQuantity: 0,
        researchingQuantity: 0,
        unfulfillableQuantity: 0,
      },
      {
        // UNKNOWN stock: Amazon reported non-numeric/unavailable.
        sku: 'BANDE-002',
        marketplaceId,
        totalQuantity: null,
      },
    ];

    this.awdInventory = seed?.awdInventory ?? [
      {
        sku: 'BANDE-001',
        marketplaceId,
        fnSku: 'X000111AAA',
        replenishmentQuantity: 25,
        totalQuantity: 25,
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

  async listAwdInventory(
    _opts: ListAwdInventoryOptions = {},
  ): Promise<AwdInventorySummary[]> {
    return this.awdInventory;
  }

  async createLedgerReport(
    _opts: CreateLedgerReportOptions,
  ): Promise<string> {
    return 'fake-ledger-report';
  }

  async getReportUntilDone(
    _opts: GetReportUntilDoneOptions,
  ): Promise<CompletedReport> {
    return {
      reportId: 'fake-ledger-report',
      reportDocumentId: 'fake-ledger-document',
    };
  }

  async downloadReportDocument(
    _opts: DownloadReportDocumentOptions,
  ): Promise<string> {
    return [
      'Date\tFNSKU\tMSKU\tDisposition\tCustomer Shipments\tEnding Warehouse Balance',
      '2026-07-21\tX000111AAA\tBANDE-001\tSELLABLE\t2\t42',
      '2026-07-20\tX000111AAA\tBANDE-001\tSELLABLE\t1\t40',
      '2026-07-21\t\tBANDE-002\tSELLABLE\t0\t0',
    ].join('\n');
  }
}
