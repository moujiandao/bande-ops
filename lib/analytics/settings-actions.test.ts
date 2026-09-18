import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), createClient: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
import { saveAnalyticsSettingsAction } from './settings-actions';

const previous = { saved: null, error: null };
function form(value: string) {
  const data = new FormData();
  data.set('excludeVine', value);
  data.set('marketplaceId', 'tampered');
  return data;
}
function mockWrite(data: unknown, error: unknown = null) {
  const upsert = vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data, error }) })) }));
  const from = vi.fn(() => ({ upsert }));
  mocks.createClient.mockResolvedValue({ from });
  return { upsert, from };
}

beforeEach(() => vi.resetAllMocks());

describe('analytics preference action', () => {
  it('requires authentication before reading or writing settings', async () => {
    mocks.requireUser.mockRejectedValue(new Error('Unauthenticated'));
    await expect(saveAnalyticsSettingsAction(previous, form('true'))).rejects.toThrow('Unauthenticated');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([true, false])('saves %s using the authenticated client and invalidates all consumers', async (enabled) => {
    const { upsert } = mockWrite({ exclude_vine: enabled });
    expect(await saveAnalyticsSettingsAction(previous, form(String(enabled)))).toEqual({ saved: enabled, error: null });
    expect(upsert).toHaveBeenCalledWith({ marketplace_id: 'ATVPDKIKX0DER', exclude_vine: enabled }, { onConflict: 'marketplace_id' });
    expect(mocks.revalidatePath.mock.calls.flat()).toEqual(['/settings', '/analytics', '/reorder', '/replenishment']);
  });

  it('rejects malformed or missing values without switching the preference off', async () => {
    expect((await saveAnalyticsSettingsAction(previous, form('yes'))).error).toBeTruthy();
    expect((await saveAnalyticsSettingsAction(previous, new FormData())).error).toBeTruthy();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('reports failed or unconfirmed writes without a saved confirmation', async () => {
    mockWrite(null, { message: 'RLS rejected' });
    const failed = await saveAnalyticsSettingsAction({ saved: false, error: null }, form('true'));
    expect(failed.saved).toBe(false);
    expect(failed.error).toBeTruthy();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mockWrite({ exclude_vine: false });
    expect((await saveAnalyticsSettingsAction(previous, form('true'))).error).toBeTruthy();
  });

  it('reports network errors without exposing internal errors', async () => {
    mocks.createClient.mockRejectedValue(new Error('private internal data'));
    const result = await saveAnalyticsSettingsAction(previous, form('true'));
    expect(result.saved).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain('private');
  });
});
