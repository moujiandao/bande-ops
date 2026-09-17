import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireUser: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
  marketplaceEq: vi.fn(),
  skuEq: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth/guard', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { archiveSkuAction, unarchiveSkuAction } from './actions';

function skuForm(sku = 'SKU-1'): FormData {
  const formData = new FormData();
  formData.set('sku', sku);
  return formData;
}

describe('archive SKU actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: 'user-1', role: 'staff' });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.skuEq.mockResolvedValue({ error: null });
    mocks.marketplaceEq.mockReturnValue({ eq: mocks.skuEq });
    mocks.delete.mockReturnValue({ eq: mocks.marketplaceEq });
    mocks.from.mockReturnValue({
      upsert: mocks.upsert,
      delete: mocks.delete,
    });
    mocks.createClient.mockResolvedValue({ from: mocks.from });
  });

  it('archives a SKU as the authenticated user and refreshes affected pages', async () => {
    await archiveSkuAction(skuForm());

    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith('archived_skus');
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        marketplace_id: 'ATVPDKIKX0DER',
        sku: 'SKU-1',
        archived_by: 'user-1',
        archived_at: expect.any(String),
      }),
      { onConflict: 'marketplace_id,sku' },
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      '/catalog',
      '/reorder',
      '/settings',
    ]);
  });

  it('unarchives only the requested marketplace SKU', async () => {
    await unarchiveSkuAction(skuForm());

    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.marketplaceEq).toHaveBeenCalledWith(
      'marketplace_id',
      'ATVPDKIKX0DER',
    );
    expect(mocks.skuEq).toHaveBeenCalledWith('sku', 'SKU-1');
  });

  it('rejects an empty SKU before opening a database client', async () => {
    await expect(archiveSkuAction(skuForm('   '))).rejects.toThrow(
      'A SKU is required.',
    );

    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
