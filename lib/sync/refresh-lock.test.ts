import { describe, expect, it, vi } from 'vitest';
import { withRefreshLock, type RefreshLockClient } from './refresh-lock';

function clientWithResponses(
  ...responses: Array<{ data: unknown; error: { message: string } | null }>
) {
  const rpc = vi.fn();
  for (const response of responses) rpc.mockResolvedValueOnce(response);
  return { admin: { rpc } as RefreshLockClient, rpc };
}

describe('withRefreshLock', () => {
  it('runs and releases an operation under the same owner token', async () => {
    const { admin, rpc } = clientWithResponses(
      { data: true, error: null },
      { data: true, error: null },
    );
    const operation = vi.fn().mockResolvedValue('done');

    await expect(
      withRefreshLock({ admin, source: 'svd_inventory' }, operation),
    ).resolves.toBe('done');

    const ownerToken = rpc.mock.calls[0]?.[1].p_owner_token;
    expect(rpc).toHaveBeenNthCalledWith(1, 'acquire_sync_refresh_lock', {
      p_source: 'svd_inventory',
      p_owner_token: ownerToken,
      p_ttl_seconds: 600,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'release_sync_refresh_lock', {
      p_source: 'svd_inventory',
      p_owner_token: ownerToken,
    });
  });

  it('rejects an overlapping refresh before running it', async () => {
    const { admin } = clientWithResponses({ data: false, error: null });
    const operation = vi.fn();

    await expect(
      withRefreshLock({ admin, source: 'svd_inventory' }, operation),
    ).rejects.toThrow('already in progress');
    expect(operation).not.toHaveBeenCalled();
  });

  it('releases the lock when the refresh fails', async () => {
    const { admin, rpc } = clientWithResponses(
      { data: true, error: null },
      { data: true, error: null },
    );

    await expect(
      withRefreshLock({ admin, source: 'svd_inventory' }, async () => {
        throw new Error('refresh failed');
      }),
    ).rejects.toThrow('refresh failed');

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith(
      'release_sync_refresh_lock',
      expect.any(Object),
    );
  });
});
