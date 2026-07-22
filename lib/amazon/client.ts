import 'server-only';

import { gunzipSync } from 'node:zlib';
import { getAmazonConfig } from './config';
import { getAccessToken } from './lwa';
import {
  buildLedgerReportBody,
  type ReportDocument,
  type ReportStatus,
} from './reports';
import {
  DEFAULT_MARKETPLACE,
  type CatalogItem,
  type AwdInventorySummary,
  type InventorySummary,
  type Marketplace,
  type MarketplaceId,
} from './types';

/**
 * The single test seam for the whole app.
 *
 * AmazonClient is a deep module: a tiny, well-typed interface that hides all
 * SP-API surface, LWA auth, host routing, and retry/backoff. Modules depend on
 * this interface; tests inject FakeAmazonClient.
 */
export interface AmazonClient {
  listCatalogItems(opts?: ListCatalogItemsOptions): Promise<CatalogItem[]>;
  getInventorySummaries(
    opts?: GetInventorySummariesOptions,
  ): Promise<InventorySummary[]>;
  listAwdInventory(
    opts?: ListAwdInventoryOptions,
  ): Promise<AwdInventorySummary[]>;
  createLedgerReport(opts: CreateLedgerReportOptions): Promise<string>;
  getReportUntilDone(opts: GetReportUntilDoneOptions): Promise<CompletedReport>;
  downloadReportDocument(opts: DownloadReportDocumentOptions): Promise<string>;
}

export interface ListCatalogItemsOptions {
  marketplace?: Marketplace;
  /** Optional identifier filter (e.g. SKUs) passed to Catalog Items API. */
  sellerSkus?: string[];
}

export interface GetInventorySummariesOptions {
  marketplace?: Marketplace;
  sellerSkus?: string[];
}

export interface ListAwdInventoryOptions {
  marketplace?: Marketplace;
  sellerSku?: string;
}

export interface CreateLedgerReportOptions {
  marketplace?: Marketplace;
  dataStartTime: string;
  dataEndTime: string;
}

export interface GetReportUntilDoneOptions {
  marketplace?: Marketplace;
  reportId: string;
  maxAttempts?: number;
  pollDelayMs?: number;
}

export interface CompletedReport {
  reportId: string;
  reportDocumentId: string;
}

export interface DownloadReportDocumentOptions {
  marketplace?: Marketplace;
  reportDocumentId: string;
}

/** Retry tuning for transient SP-API failures (429 / 5xx). */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

interface RequestOptions {
  method?: string;
  /** Path beginning with '/', appended to the marketplace host. */
  path: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  marketplace: Marketplace;
}

function buildUrl(host: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(`https://${host}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : value);
    }
  }
  return url.toString();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter, capped. */
function backoffDelay(attempt: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Coerce a possibly-non-numeric Amazon quantity into number | null.
 * UNKNOWN (non-numeric/unavailable) maps to null, never 0.
 */
function toQuantity(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}

export class SpApiClient implements AmazonClient {
  /**
   * Signed, retrying request against the marketplace's SP-API host.
   * Adds the LWA token required by SP-API.
   */
  private async request<T>(opts: RequestOptions): Promise<T> {
    const config = getAmazonConfig(opts.marketplace);
    const url = buildUrl(config.host, opts.path, opts.query);

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Refresh token each attempt in case a long backoff outlived the token.
      const accessToken = await getAccessToken();

      let res: Response;
      try {
        res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers: {
            'x-amz-access-token': accessToken,
            accept: 'application/json',
            ...(opts.body ? { 'content-type': 'application/json' } : {}),
          },
          ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
          cache: 'no-store',
        });
      } catch (err) {
        // Network/transport error: retry while attempts remain.
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw err;
      }

      if (res.ok) {
        return (await res.json()) as T;
      }

      // Transient HTTP failure: back off and retry.
      if (isRetryable(res.status) && attempt < MAX_RETRIES) {
        await sleep(backoffDelay(attempt));
        continue;
      }

      // Non-retryable (4xx) or out of retries: fail without re-looping.
      const detail = await res.text().catch(() => '');
      throw new Error(
        `SP-API ${opts.method ?? 'GET'} ${opts.path} failed: ${res.status} ${
          res.statusText
        }${detail ? ` — ${detail}` : ''}`,
      );
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('SP-API request failed after retries.');
  }

  async listCatalogItems(
    opts: ListCatalogItemsOptions = {},
  ): Promise<CatalogItem[]> {
    const marketplace = opts.marketplace ?? DEFAULT_MARKETPLACE;
    // Catalog Items API (2022-04-01). TODO: verify against sandbox.
    const config = getAmazonConfig(marketplace);
    const items: CatalogItem[] = [];
    let nextToken: string | undefined;

    do {
      const data = await this.request<CatalogItemsResponse>({
        path: '/catalog/2022-04-01/items',
        marketplace,
        query: {
          marketplaceIds: marketplace.id,
          includedData: 'identifiers,summaries,images',
          identifiers: opts.sellerSkus,
          identifiersType: opts.sellerSkus ? 'SKU' : undefined,
          sellerId: opts.sellerSkus ? config.sellerId : undefined,
          pageToken: nextToken,
        },
      });
      items.push(...(data.items ?? []).map(mapCatalogItem));
      nextToken = data.pagination?.nextToken;
    } while (nextToken);

    return items;
  }

  async getInventorySummaries(
    opts: GetInventorySummariesOptions = {},
  ): Promise<InventorySummary[]> {
    const marketplace = opts.marketplace ?? DEFAULT_MARKETPLACE;
    // FBA Inventory API (v1). TODO: verify against sandbox.
    const summaries: InventorySummary[] = [];
    let nextToken: string | undefined;

    do {
      const data = await this.request<InventorySummariesResponse>({
        path: '/fba/inventory/v1/summaries',
        marketplace,
        query: {
          details: 'true',
          granularityType: 'Marketplace',
          granularityId: marketplace.id,
          marketplaceIds: marketplace.id,
          sellerSkus: opts.sellerSkus,
          nextToken,
        },
      });
      summaries.push(
        ...(data.payload?.inventorySummaries ?? []).map((summary) =>
          mapInventorySummary(summary, marketplace.id),
        ),
      );
      nextToken = data.pagination?.nextToken;
    } while (nextToken);

    return summaries;
  }

  async listAwdInventory(
    opts: ListAwdInventoryOptions = {},
  ): Promise<AwdInventorySummary[]> {
    const marketplace = opts.marketplace ?? DEFAULT_MARKETPLACE;
    const summaries: AwdInventorySummary[] = [];
    let nextToken: string | undefined;

    do {
      const data = await this.request<AwdInventoryResponse>({
        path: '/awd/2024-05-09/inventory',
        marketplace,
        query: {
          details: 'SHOW',
          sku: opts.sellerSku,
          nextToken,
        },
      });
      summaries.push(
        ...(data.inventory ?? []).map((summary) =>
          mapAwdInventorySummary(summary, marketplace.id),
        ),
      );
      nextToken = data.nextToken;
    } while (nextToken);

    return summaries;
  }

  async createLedgerReport(opts: CreateLedgerReportOptions): Promise<string> {
    const marketplace = opts.marketplace ?? DEFAULT_MARKETPLACE;
    const data = await this.request<{ reportId?: string }>({
      method: 'POST',
      path: '/reports/2021-06-30/reports',
      marketplace,
      body: buildLedgerReportBody({
        marketplaceId: marketplace.id,
        dataStartTime: opts.dataStartTime,
        dataEndTime: opts.dataEndTime,
      }),
    });

    if (!data.reportId) {
      throw new Error('createLedgerReport: SP-API did not return reportId.');
    }
    return data.reportId;
  }

  async getReportUntilDone(
    opts: GetReportUntilDoneOptions,
  ): Promise<CompletedReport> {
    const marketplace = opts.marketplace ?? DEFAULT_MARKETPLACE;
    const maxAttempts = opts.maxAttempts ?? 60;
    const pollDelayMs = opts.pollDelayMs ?? 5_000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const report = await this.request<ReportStatus>({
        path: `/reports/2021-06-30/reports/${encodeURIComponent(opts.reportId)}`,
        marketplace,
      });

      if (report.processingStatus === 'DONE') {
        if (!report.reportDocumentId) {
          throw new Error(`Report ${opts.reportId} completed without document id.`);
        }
        return {
          reportId: opts.reportId,
          reportDocumentId: report.reportDocumentId,
        };
      }

      if (
        report.processingStatus === 'FATAL' ||
        report.processingStatus === 'CANCELLED'
      ) {
        throw new Error(
          `Report ${opts.reportId} ended with ${report.processingStatus}.`,
        );
      }

      if (attempt < maxAttempts - 1) {
        await sleep(pollDelayMs);
      }
    }

    throw new Error(`Report ${opts.reportId} did not finish before timeout.`);
  }

  async downloadReportDocument(
    opts: DownloadReportDocumentOptions,
  ): Promise<string> {
    const marketplace = opts.marketplace ?? DEFAULT_MARKETPLACE;
    const document = await this.request<ReportDocument>({
      path: `/reports/2021-06-30/documents/${encodeURIComponent(
        opts.reportDocumentId,
      )}`,
      marketplace,
    });

    const res = await fetch(document.url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(
        `Report document download failed: ${res.status} ${res.statusText}`,
      );
    }

    if (document.compressionAlgorithm === 'GZIP') {
      const buffer = Buffer.from(await res.arrayBuffer());
      return gunzipSync(buffer).toString('utf8');
    }

    return res.text();
  }
}

// --- SP-API raw response shapes (partial; only what we map) ---

interface CatalogItemsResponse {
  items?: RawCatalogItem[];
  pagination?: Pagination;
}

interface RawCatalogItem {
  asin?: string;
  summaries?: Array<{ itemName?: string; marketplaceId?: string }>;
  identifiers?: Array<{
    marketplaceId?: string;
    identifiers?: Array<{ identifierType?: string; identifier?: string }>;
  }>;
  images?: Array<{
    marketplaceId?: string;
    images?: Array<{ link?: string }>;
  }>;
}

interface InventorySummariesResponse {
  payload?: {
    inventorySummaries?: RawInventorySummary[];
  };
  pagination?: Pagination;
}

interface Pagination {
  nextToken?: string;
}

interface RawInventorySummary {
  sellerSku?: string;
  fnSku?: string;
  totalQuantity?: unknown;
  inventoryDetails?: {
    fulfillableQuantity?: unknown;
    inboundWorkingQuantity?: unknown;
    inboundShippedQuantity?: unknown;
    inboundReceivingQuantity?: unknown;
    reservedQuantity?: { totalReservedQuantity?: unknown };
    researchingQuantity?: { totalResearchingQuantity?: unknown };
    unfulfillableQuantity?: { totalUnfulfillableQuantity?: unknown };
  };
}

interface AwdInventoryResponse {
  inventory?: RawAwdInventorySummary[];
  nextToken?: string;
}

interface RawAwdInventorySummary {
  sku?: string;
  fnSku?: string;
  replenishmentQuantity?: unknown;
  totalQuantity?: unknown;
}

function mapCatalogItem(raw: RawCatalogItem): CatalogItem {
  const asin = raw.asin ?? '';
  const title = raw.summaries?.[0]?.itemName ?? '';
  const skuId = raw.identifiers
    ?.flatMap((g) => g.identifiers ?? [])
    .find((i) => i.identifierType === 'SKU')?.identifier;
  const imageUrl = raw.images?.[0]?.images?.[0]?.link;

  return {
    sku: skuId ?? '',
    asin,
    title,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function mapInventorySummary(
  raw: RawInventorySummary,
  marketplaceId: MarketplaceId,
): InventorySummary {
  const details = raw.inventoryDetails;
  return {
    sku: raw.sellerSku ?? '',
    marketplaceId,
    totalQuantity: toQuantity(raw.totalQuantity),
    ...(raw.fnSku ? { fnSku: raw.fnSku } : {}),
    fulfillableQuantity: toQuantity(details?.fulfillableQuantity),
    inboundWorkingQuantity: toQuantity(details?.inboundWorkingQuantity),
    inboundShippedQuantity: toQuantity(details?.inboundShippedQuantity),
    inboundReceivingQuantity: toQuantity(details?.inboundReceivingQuantity),
    reservedQuantity: toQuantity(details?.reservedQuantity?.totalReservedQuantity),
    researchingQuantity: toQuantity(
      details?.researchingQuantity?.totalResearchingQuantity,
    ),
    unfulfillableQuantity: toQuantity(
      details?.unfulfillableQuantity?.totalUnfulfillableQuantity,
    ),
  };
}

function mapAwdInventorySummary(
  raw: RawAwdInventorySummary,
  marketplaceId: MarketplaceId,
): AwdInventorySummary {
  return {
    sku: raw.sku ?? '',
    marketplaceId,
    ...(raw.fnSku ? { fnSku: raw.fnSku } : {}),
    replenishmentQuantity: toQuantity(raw.replenishmentQuantity),
    totalQuantity: toQuantity(raw.totalQuantity),
  };
}
