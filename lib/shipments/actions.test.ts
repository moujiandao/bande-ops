import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), sync: vi.fn(), revalidate: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireUser: mocks.auth }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/amazon', () => ({ getAmazonClient: vi.fn(() => ({})) }));
vi.mock('./sync', () => ({ syncShipmentEvidence: mocks.sync }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { refreshShipmentEvidenceAction } from './actions';

describe('authenticated evidence refresh', () => {
  beforeEach(() => vi.resetAllMocks());
  it('rejects an unauthenticated caller before accessing admin or Amazon', async () => {
    mocks.auth.mockRejectedValue(new Error('Unauthorized'));
    await expect(refreshShipmentEvidenceAction()).rejects.toThrow('Unauthorized');
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('allows ordinary users and revalidates all affected views after a pending refresh', async () => {
    mocks.auth.mockResolvedValue({ role: 'staff' });
    mocks.sync.mockResolvedValue({ status: 'pending', publishedDays: 10, issue: null });
    expect(await refreshShipmentEvidenceAction()).toMatchObject({ error: null, message: expect.stringContaining('preparing reports') });
    expect(mocks.revalidate.mock.calls.flat()).toEqual(['/settings', '/analytics', '/reorder', '/replenishment']);
  });
  it('reports failures without leaking remote response content', async () => {
    mocks.auth.mockResolvedValue({ role: 'staff' });
    mocks.sync.mockRejectedValue(new Error('private payload'));
    expect((await refreshShipmentEvidenceAction()).error).not.toContain('private');
  });
});
