import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { readAnalyticsSettings, vineAdjustmentIssue } from './settings';

function db(result: unknown, reject = false) {
  const maybeSingle = reject ? vi.fn().mockRejectedValue(new Error('network')) : vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { supabase: { from } as unknown as Pick<SupabaseClient, 'from'>, from, eq };
}

describe('marketplace analytics setting', () => {
  it('defaults off only when the query succeeds without a saved preference', async () => {
    const mock = db({ data: null, error: null });
    expect(await readAnalyticsSettings(mock.supabase)).toEqual({ excludeVine: false, error: null });
    expect(mock.eq).toHaveBeenCalledWith('marketplace_id', 'ATVPDKIKX0DER');
  });

  it.each([true, false])('reads the shared saved value %s', async (value) => {
    const mock = db({ data: { exclude_vine: value }, error: null });
    expect(await readAnalyticsSettings(mock.supabase)).toEqual({ excludeVine: value, error: null });
  });

  it.each([
    { data: null, error: { message: 'missing relation' } },
    { data: { exclude_vine: 'false' }, error: null },
  ])('fails closed on a query error or malformed setting', async (result) => {
    const settings = await readAnalyticsSettings(db(result).supabase);
    expect(settings.excludeVine).toBeNull();
    expect(vineAdjustmentIssue(settings)).toBeTruthy();
  });

  it('fails closed on network rejection', async () => {
    expect((await readAnalyticsSettings(db(null, true).supabase)).excludeVine).toBeNull();
  });

  it('does not claim adjusted results while the source is unverified', () => {
    expect(vineAdjustmentIssue({ excludeVine: true, error: null })).toContain('unavailable');
    expect(vineAdjustmentIssue({ excludeVine: false, error: null })).toBeNull();
  });
});
