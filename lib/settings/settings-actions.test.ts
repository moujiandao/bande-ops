import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireUser: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('@/lib/auth/guard', () => ({
  requireUser: mocks.requireUser,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

import { savePolicyAction } from './settings-actions';

function policyForm(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const values = {
    velocitySampleInStockDays: '90',
    velocityMaxLookbackDays: '365',
    countInboundShipped: 'on',
    countInboundReceiving: 'on',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

describe('savePolicyAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ upsert: mocks.upsert });
    mocks.createClient.mockResolvedValue({ from: mocks.from });
  });

  it('parses the form and upserts the global replenishment policy', async () => {
    const formData = policyForm({ countInboundWorking: 'on' });

    await savePolicyAction(formData);

    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith('replenishment_policy');
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        marketplace_id: 'ATVPDKIKX0DER',
        velocity_sample_in_stock_days: 90,
        velocity_max_lookback_days: 365,
        fulfillment_mode: 'fba_only',
        svd_mode: 'replenishment_only',
        unknown_stock_mode: 'needs_review',
        stale_source_mode: 'needs_review',
        count_inbound_working: true,
        count_inbound_shipped: true,
        count_inbound_receiving: true,
        updated_at: expect.any(String),
      }),
      { onConflict: 'marketplace_id' },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/reorder');
  });

  it('persists unchecked inbound checkboxes as false', async () => {
    await savePolicyAction(
      policyForm({
        countInboundShipped: '',
        countInboundReceiving: '',
      }),
    );

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        count_inbound_working: false,
        count_inbound_shipped: false,
        count_inbound_receiving: false,
      }),
      { onConflict: 'marketplace_id' },
    );
  });

  it('rejects invalid policy input before writing', async () => {
    await expect(
      savePolicyAction(
        policyForm({
          velocitySampleInStockDays: '366',
          velocityMaxLookbackDays: '365',
        }),
      ),
    ).rejects.toThrow('velocity sample days must be <= max lookback days');

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
