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
});
