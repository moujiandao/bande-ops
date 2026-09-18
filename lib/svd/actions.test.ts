import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireUser: vi.fn(),
  createAdminClient: vi.fn(),
  refreshSvdInventory: vi.fn(),
  rpc: vi.fn(),
  httpSvdClient: {},
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('@/lib/auth/guard', () => ({
  requireUser: mocks.requireUser,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('./client', () => ({
  HttpSvdClient: class {
    constructor() {
      return mocks.httpSvdClient;
    }
  },
}));

vi.mock('./sync', () => ({
  refreshSvdInventory: mocks.refreshSvdInventory,
}));

import { refreshSvdInventoryAction } from './actions';

describe('refreshSvdInventoryAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      id: 'staff-1',
      email: 'staff@example.com',
      role: 'staff',
    });
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(), rpc: mocks.rpc });
    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.refreshSvdInventory.mockResolvedValue({ count: 1, syncRunId: 'run-1' });
  });

  it('allows an authenticated staff user to refresh SVD inventory', async () => {
    await refreshSvdInventoryAction();

    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.refreshSvdInventory).toHaveBeenCalledWith({
      admin: mocks.createAdminClient.mock.results[0]?.value,
      client: mocks.httpSvdClient,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/reorder');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/replenishment');
  });

  it('does not create clients or refresh when authentication fails', async () => {
    mocks.requireUser.mockRejectedValue(new Error('Unauthenticated'));

    await expect(refreshSvdInventoryAction()).rejects.toThrow('Unauthenticated');

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.refreshSvdInventory).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('does not refresh while another SVD refresh holds the lock', async () => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });

    await expect(refreshSvdInventoryAction()).rejects.toThrow(
      'already in progress',
    );

    expect(mocks.refreshSvdInventory).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
