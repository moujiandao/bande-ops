import { describe, it, expect } from 'vitest';
import { FakeAmazonClient } from './fake-client';
import { DEFAULT_MARKETPLACE } from './types';

// The AmazonClient interface is the app's single test seam. These tests pin the
// behavior modules rely on when they inject FakeAmazonClient — especially the
// UNKNOWN-stock convention (null, never 0), which the reorder math depends on.
//
// NOTE: import FakeAmazonClient from './fake-client' directly (not the barrel
// '@/lib/amazon'), because the barrel pulls SpApiClient -> 'server-only', which
// throws outside a server context.

describe('FakeAmazonClient (test seam)', () => {
  it('lists catalog items with sku/asin/title', async () => {
    const client = new FakeAmazonClient();
    // Catalog Items is a search API — the fake requires identifiers just as
    // the real one does.
    const items = await client.listCatalogItems({
      sellerSkus: ['BANDE-001', 'BANDE-002'],
    });

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.sku).toBeTruthy();
      expect(item.asin).toBeTruthy();
      expect(item.title).toBeTruthy();
    }
  });

  it('represents UNKNOWN stock as null — never 0', async () => {
    const client = new FakeAmazonClient();
    const summaries = await client.getInventorySummaries();

    const unknown = summaries.find((s) => s.totalQuantity === null);
    expect(unknown, 'fake must include a null/UNKNOWN inventory row').toBeDefined();
    // The whole point of the convention: null is distinct from a true zero.
    expect(unknown!.totalQuantity).toBeNull();
    expect(unknown!.totalQuantity).not.toBe(0);

    const known = summaries.find((s) => typeof s.totalQuantity === 'number');
    expect(known, 'fake must include a numeric inventory row').toBeDefined();
    expect(known!.totalQuantity).toBeGreaterThanOrEqual(0);
  });

  it('tags inventory with the marketplace dimension (US by default)', async () => {
    const summaries = await new FakeAmazonClient().getInventorySummaries();
    for (const s of summaries) {
      expect(s.marketplaceId).toBe(DEFAULT_MARKETPLACE.id);
    }
  });

  it('seeds detailed FBA buckets for the known inventory row', async () => {
    const summaries = await new FakeAmazonClient().getInventorySummaries();

    expect(summaries.find((summary) => summary.sku === 'BANDE-001')).toMatchObject({
      fulfillableQuantity: 42,
      inboundShippedQuantity: 10,
      inboundReceivingQuantity: 5,
      inboundWorkingQuantity: 0,
      reservedQuantity: 0,
      researchingQuantity: 0,
      unfulfillableQuantity: 0,
    });
  });

  it('lists AWD replenishment inventory separately from FBA inventory', async () => {
    const summaries = await new FakeAmazonClient().listAwdInventory();

    expect(summaries).toMatchObject([
      {
        sku: 'BANDE-001',
        marketplaceId: DEFAULT_MARKETPLACE.id,
        replenishmentQuantity: 25,
      },
    ]);
  });

  it('accepts a seed so tests can stage their own scenarios', async () => {
    const client = new FakeAmazonClient({
      inventory: [
        { sku: 'SEED-1', marketplaceId: DEFAULT_MARKETPLACE.id, totalQuantity: null },
      ],
    });
    const [only] = await client.getInventorySummaries();
    expect(only.sku).toBe('SEED-1');
    expect(only.totalQuantity).toBeNull();
  });
});
