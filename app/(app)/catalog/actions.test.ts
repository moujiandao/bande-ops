import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), catalog: vi.fn(), inventory: vi.fn(),
  revalidate: vi.fn(), admin: vi.fn(), client: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireUser: mocks.auth }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/amazon', () => ({ getAmazonClient: mocks.client }));
vi.mock('@/lib/catalog/sync', () => ({ syncCatalog: mocks.catalog }));
vi.mock('@/lib/inventory/sync', () => ({ syncInventory: mocks.inventory }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { syncCatalogAction } from './actions';

describe('manual catalog and inventory refresh', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.auth.mockResolvedValue({ role: 'staff' });
    mocks.catalog.mockResolvedValue({ count: 188 });
    mocks.inventory.mockResolvedValue({ count: 191 });
  });

  it('refreshes inventory and returns a recoverable result when catalog is throttled', async () => {
    // Captured production failure: Vercel /catalog POST, 2026-09-18 07:25 UTC.
    mocks.catalog.mockRejectedValue(new Error(
      'SP-API GET /catalog/2022-04-01/items failed: 429',
    ));
    const result = await syncCatalogAction();
    expect(mocks.inventory).toHaveBeenCalledOnce();
    expect(result).toEqual({
      message: 'FBA inventory refreshed (191 SKUs).',
      error: 'Catalog could not refresh because Amazon is limiting requests. Try again in a few minutes.',
    });
    expect(mocks.revalidate.mock.calls.flat()).toEqual([
      '/catalog', '/reorder', '/replenishment', '/analytics',
    ]);
  });

  it('rejects unauthenticated callers before accessing privileged dependencies', async () => {
    mocks.auth.mockRejectedValue(new Error('Unauthorized'));
    await expect(syncCatalogAction()).rejects.toThrow('Unauthorized');
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.inventory).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it('reports both successful mirrors for a staff user', async () => {
    expect(await syncCatalogAction()).toEqual({
      message: 'FBA inventory refreshed (191 SKUs). Catalog refreshed (188 SKUs).',
      error: null,
    });
    expect(mocks.inventory.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.catalog.mock.invocationCallOrder[0],
    );
  });

  it('continues catalog after an inventory failure without exposing remote details', async () => {
    mocks.inventory.mockRejectedValue(new Error('private remote response'));
    expect(await syncCatalogAction()).toEqual({
      message: 'Catalog refreshed (188 SKUs).',
      error: 'FBA inventory could not refresh. Try again later.',
    });
    expect(mocks.catalog).toHaveBeenCalledOnce();
    // Revalidate failed source health as well as successful mirror changes.
    expect(mocks.revalidate).toHaveBeenCalledWith('/reorder');
  });

  it('reports both failures without claiming either mirror was refreshed', async () => {
    mocks.inventory.mockRejectedValue(new Error('inventory failed'));
    mocks.catalog.mockRejectedValue(new Error('catalog failed'));
    expect(await syncCatalogAction()).toEqual({
      message: '',
      error: 'FBA inventory could not refresh. Try again later. Catalog could not refresh. Try again later.',
    });
  });

  it('handles dependency setup failures without attempting a sync', async () => {
    mocks.admin.mockImplementation(() => { throw new Error('private config'); });
    expect(await syncCatalogAction()).toEqual({
      message: '', error: 'Could not start the refresh. Check the server configuration and try again.',
    });
    expect(mocks.inventory).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});
