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

import {
  savePolicyAction,
  saveDefaultsAction,
  saveSkuOverrideAction,
  saveSvdUnitsPerBoxAction,
} from './settings-actions';

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

// The writeSetting path (global default + per-SKU override) resolves an existing
// row via select().eq()/is().maybeSingle(), then insert()s or update()s. This
// mock records the insert/update payload so we can assert coverage handling.
function makeSettingsClient(existingId: string | null = null) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: existingId ? { id: existingId } : null, error: null });
  const eqLeaf = { maybeSingle };
  const select = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      is: vi.fn().mockReturnValue(eqLeaf),
      eq: vi.fn().mockReturnValue(eqLeaf),
    }),
  });
  const from = vi.fn().mockReturnValue({ select, insert, update });
  return { client: { from }, insert, update };
}

describe('saveDefaultsAction coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
  });

  it('stores the global default coverage as days (months × 30)', async () => {
    const { client, insert } = makeSettingsClient(null);
    mocks.createClient.mockResolvedValue(client);

    const form = new FormData();
    form.set('leadTimeDays', '14');
    form.set('safetyStock', '0');
    form.set('coverageMonths', '3');

    await saveDefaultsAction(form);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ sku: null, target_coverage_days: 90 }),
    );
  });

  it('rejects a missing global default coverage before writing', async () => {
    const { client, insert } = makeSettingsClient(null);
    mocks.createClient.mockResolvedValue(client);

    const form = new FormData();
    form.set('leadTimeDays', '14');
    form.set('safetyStock', '0');
    // no coverageMonths

    await expect(saveDefaultsAction(form)).rejects.toThrow('Coverage (months) is required.');
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('saveSkuOverrideAction coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
  });

  it('stores a per-SKU coverage override as days', async () => {
    const { client, insert } = makeSettingsClient(null);
    mocks.createClient.mockResolvedValue(client);

    const form = new FormData();
    form.set('sku', 'SKU-1');
    form.set('leadTimeDays', '7');
    form.set('safetyStock', '5');
    form.set('coverageMonths', '2');

    await saveSkuOverrideAction(form);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'SKU-1', target_coverage_days: 60 }),
    );
  });

  it('stores NULL coverage when the per-SKU override leaves it blank (falls back to default)', async () => {
    const { client, insert } = makeSettingsClient(null);
    mocks.createClient.mockResolvedValue(client);

    const form = new FormData();
    form.set('sku', 'SKU-1');
    form.set('leadTimeDays', '7');
    form.set('safetyStock', '5');
    form.set('coverageMonths', '');

    await saveSkuOverrideAction(form);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'SKU-1', target_coverage_days: null }),
    );
  });
});

describe('saveSvdUnitsPerBoxAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: 'user-1' });
  });

  it('inserts a per-SKU row carrying only the box size when none exists', async () => {
    const { client, insert } = makeSettingsClient(null);
    mocks.createClient.mockResolvedValue(client);

    const form = new FormData();
    form.set('sku', 'SKU-1');
    form.set('svdUnitsPerBox', '60');

    await saveSvdUnitsPerBoxAction(form);

    const payload = insert.mock.calls[0][0];
    expect(payload).toMatchObject({ sku: 'SKU-1', svd_units_per_box: 60 });
    // Lead time and safety stock must be absent, so the row inherits them from
    // the global default rather than pinning them.
    expect(payload).not.toHaveProperty('lead_time_days');
    expect(payload).not.toHaveProperty('safety_stock');
  });

  it('updates the existing row without disturbing its other fields', async () => {
    const { client, insert, update } = makeSettingsClient('row-9');
    mocks.createClient.mockResolvedValue(client);

    const form = new FormData();
    form.set('sku', 'SKU-1');
    form.set('svdUnitsPerBox', '30');

    await saveSvdUnitsPerBoxAction(form);

    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ svd_units_per_box: 30 }),
    );
  });

  it('stores NULL to clear the box size when the field is blank', async () => {
    const { client, insert } = makeSettingsClient(null);
    mocks.createClient.mockResolvedValue(client);

    const form = new FormData();
    form.set('sku', 'SKU-1');
    form.set('svdUnitsPerBox', '');

    await saveSvdUnitsPerBoxAction(form);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ svd_units_per_box: null }),
    );
  });

  it('rejects a zero or negative box size before writing', async () => {
    const { client, insert } = makeSettingsClient(null);
    mocks.createClient.mockResolvedValue(client);

    const form = new FormData();
    form.set('sku', 'SKU-1');
    form.set('svdUnitsPerBox', '0');

    await expect(saveSvdUnitsPerBoxAction(form)).rejects.toThrow('positive whole number');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a missing SKU', async () => {
    const form = new FormData();
    form.set('svdUnitsPerBox', '60');

    await expect(saveSvdUnitsPerBoxAction(form)).rejects.toThrow('A SKU is required');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
