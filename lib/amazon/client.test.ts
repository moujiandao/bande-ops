import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./lwa', () => ({
  getAccessToken: vi.fn().mockResolvedValue('access-token'),
}));
vi.mock('./config', () => ({
  getAmazonConfig: vi.fn(() => ({
    host: 'spapi.test',
    sellerId: 'seller-id',
  })),
}));

import { SpApiClient } from './client';

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SpApiClient', () => {
  it('requests detailed FBA inventory with only the x-amz access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        payload: {
          inventorySummaries: [
            {
              sellerSku: 'SKU-1',
              totalQuantity: 20,
              inventoryDetails: {
                fulfillableQuantity: 7,
                inboundWorkingQuantity: 0,
                inboundShippedQuantity: 5,
                inboundReceivingQuantity: 2,
                reservedQuantity: { totalReservedQuantity: 3 },
                researchingQuantity: { totalResearchingQuantity: 1 },
                unfulfillableQuantity: { totalUnfulfillableQuantity: 2 },
              },
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const summaries = await new SpApiClient().getInventorySummaries();

    const [requestUrl, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = request.headers as Record<string, string>;
    expect(String(requestUrl)).toContain('details=true');
    expect(headers).toMatchObject({ 'x-amz-access-token': 'access-token' });
    expect(headers).not.toHaveProperty('authorization');
    expect(summaries).toMatchObject([
      {
        fulfillableQuantity: 7,
        inboundWorkingQuantity: 0,
        inboundShippedQuantity: 5,
        inboundReceivingQuantity: 2,
        reservedQuantity: 3,
        researchingQuantity: 1,
        unfulfillableQuantity: 2,
      },
    ]);
  });

  it('follows FBA inventory page tokens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          payload: {
            inventorySummaries: [
              {
                sellerSku: 'SKU-1',
                totalQuantity: 20,
              },
            ],
          },
          pagination: { nextToken: 'inventory-next' },
        }),
      )
      .mockResolvedValueOnce(
        response({
          payload: {
            inventorySummaries: [
              {
                sellerSku: 'SKU-2',
                totalQuantity: 8,
              },
            ],
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const summaries = await new SpApiClient().getInventorySummaries();

    expect(summaries.map((summary) => summary.sku)).toEqual(['SKU-1', 'SKU-2']);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      'nextToken=inventory-next',
    );
  });

  it('sends sellerId for SKU catalog lookups and follows catalog page tokens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          items: [
            {
              asin: 'ASIN-1',
              summaries: [{ itemName: 'Item 1' }],
              identifiers: [
                { identifiers: [{ identifierType: 'SKU', identifier: 'SKU-1' }] },
              ],
            },
          ],
          pagination: { nextToken: 'catalog-next' },
        }),
      )
      .mockResolvedValueOnce(
        response({
          items: [
            {
              asin: 'ASIN-2',
              summaries: [{ itemName: 'Item 2' }],
              identifiers: [
                { identifiers: [{ identifierType: 'SKU', identifier: 'SKU-2' }] },
              ],
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const items = await new SpApiClient().listCatalogItems({
      sellerSkus: ['SKU-1'],
    });

    expect(items.map((item) => item.sku)).toEqual(['SKU-1', 'SKU-2']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('sellerId=seller-id');
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=catalog-next');
  });

  it('maps and paginates AWD inventory', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          inventory: [
            {
              sku: 'SKU-1',
              fnSku: 'FNSKU-1',
              replenishmentQuantity: 25,
              totalQuantity: 40,
            },
          ],
          nextToken: 'awd-next',
        }),
      )
      .mockResolvedValueOnce(
        response({
          inventory: [
            {
              sku: 'SKU-2',
              replenishmentQuantity: null,
              totalQuantity: null,
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const summaries = await new SpApiClient().listAwdInventory();

    expect(summaries).toMatchObject([
      { sku: 'SKU-1', replenishmentQuantity: 25, totalQuantity: 40 },
      { sku: 'SKU-2', replenishmentQuantity: null, totalQuantity: null },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/awd/2024-05-09/inventory');
    expect(String(fetchMock.mock.calls[0][0])).toContain('details=SHOW');
    expect(String(fetchMock.mock.calls[1][0])).toContain('nextToken=awd-next');
  });

  it('creates a daily ledger report through the Reports API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ reportId: 'report-1' }));
    vi.stubGlobal('fetch', fetchMock);

    const reportId = await new SpApiClient().createLedgerReport({
      dataStartTime: '2025-07-21T00:00:00.000Z',
      dataEndTime: '2026-07-21T00:00:00.000Z',
    });

    expect(reportId).toBe('report-1');
    const [requestUrl, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(requestUrl)).toContain('/reports/2021-06-30/reports');
    expect(request.method).toBe('POST');
    expect(JSON.parse(String(request.body))).toMatchObject({
      reportType: 'GET_LEDGER_SUMMARY_VIEW_DATA',
      reportOptions: {
        aggregateByLocation: 'COUNTRY',
        aggregatedByTimePeriod: 'DAILY',
      },
    });
  });

  it('creates a merchant listings report with no date range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ reportId: 'report-9' }));
    vi.stubGlobal('fetch', fetchMock);

    const reportId = await new SpApiClient().createMerchantListingsReport();

    expect(reportId).toBe('report-9');
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.reportType).toBe('GET_MERCHANT_LISTINGS_ALL_DATA');
    // It is a snapshot of all listings, not a windowed report.
    expect(body.dataStartTime).toBeUndefined();
    expect(body.dataEndTime).toBeUndefined();
  });

  it('downloads report documents without Amazon auth headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          reportDocumentId: 'doc-1',
          url: 'https://documents.example/report.tsv',
        }),
      )
      .mockResolvedValueOnce(
        new Response('Date\tMSKU\n2026-07-21\tSKU-1', { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const text = await new SpApiClient().downloadReportDocument({
      reportDocumentId: 'doc-1',
    });

    expect(text).toContain('SKU-1');
    const [, documentRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(documentRequest.headers).toBeUndefined();
  });

  it.each(['FATAL', 'CANCELLED'] as const)(
    'throws on %s report failures',
    async (processingStatus) => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        reportId: 'report-1',
        processingStatus,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new SpApiClient().getReportUntilDone({
        reportId: 'report-1',
        pollDelayMs: 0,
        maxAttempts: 1,
      }),
    ).rejects.toThrow(`Report report-1 ended with ${processingStatus}.`);
    },
  );

  it('sends a descriptive User-Agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await new SpApiClient().listCatalogItems({ sellerSkus: ['SKU-1'] });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = request.headers as Record<string, string>;
    expect(headers['user-agent']).toMatch(/^bande-ops\/\d+\.\d+\.\d+ /);
  });

  it('batches SKU lookups to the 20-identifier catalog limit', async () => {
    // A fresh Response per call: a body can only be read once.
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      response({ items: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const skus = Array.from({ length: 25 }, (_, i) => `SKU-${i}`);
    await new SpApiClient().listCatalogItems({ sellerSkus: skus });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL(String(fetchMock.mock.calls[0][0]));
    const second = new URL(String(fetchMock.mock.calls[1][0]));
    expect(first.searchParams.get('identifiers')?.split(',')).toHaveLength(20);
    expect(second.searchParams.get('identifiers')?.split(',')).toHaveLength(5);
    // Every batch must still carry sellerId, or SKU lookups 400.
    expect(second.searchParams.get('sellerId')).toBe('seller-id');
  });

  it('refuses a catalog call with no identifiers instead of sending a doomed request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Catalog Items is a search API: with neither identifiers nor keywords the
    // real API returns 400 InvalidInput. Fail with a useful message instead.
    await expect(new SpApiClient().listCatalogItems()).rejects.toThrow(
      /sellerSkus/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up after MAX_RETRIES and throws rather than swallowing the failure', async () => {
    // retry-after: 0 keeps the waits instant while still exercising the loop.
    const fetchMock = vi.fn(
      async () =>
        new Response('still throttled', {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(new SpApiClient().listCatalogItems({ sellerSkus: ['SKU-1'] })).rejects.toThrow(/429/);
    // One initial attempt plus MAX_RETRIES (3) retries.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('waits the Retry-After interval before retrying a throttled request', async () => {
    const throttled = new Response('slow down', {
      status: 429,
      headers: { 'retry-after': '2' },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(throttled)
      .mockResolvedValueOnce(response({ items: [] }));
    const delays: number[] = [];
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    try {
      const pending = new SpApiClient({
        onRetryDelay: (ms) => delays.push(ms),
      }).listCatalogItems({ sellerSkus: ['SKU-1'] });
      await vi.advanceTimersByTimeAsync(2000);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2000]);
  });
});
