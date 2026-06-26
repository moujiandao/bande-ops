import { describe, it, expect } from 'vitest';
import { effectiveSetting } from './resolve';
import type { PartialReplenishment, ReplenishmentValues } from './resolve';

// effectiveSetting collapses (per-SKU override, global default) into the values
// the reorder math uses. The invariants under test: a per-SKU value wins, an
// absent override falls back to the default, partial overrides mix the two, and
// a literal 0 is treated as a real override (never as "unset").

const defaults: ReplenishmentValues = { leadTimeDays: 14, safetyStock: 10 };

type Case = {
  name: string;
  perSku: PartialReplenishment;
  expected: ReplenishmentValues;
};

const cases: Case[] = [
  {
    name: 'no override (undefined) → both fields fall back to default',
    perSku: undefined,
    expected: { leadTimeDays: 14, safetyStock: 10 },
  },
  {
    name: 'no override (null) → both fields fall back to default',
    perSku: null,
    expected: { leadTimeDays: 14, safetyStock: 10 },
  },
  {
    name: 'full override → both fields win over default',
    perSku: { leadTimeDays: 30, safetyStock: 25 },
    expected: { leadTimeDays: 30, safetyStock: 25 },
  },
  {
    name: 'partial override (lead time only) → safety stock falls back',
    perSku: { leadTimeDays: 7 },
    expected: { leadTimeDays: 7, safetyStock: 10 },
  },
  {
    name: 'partial override (safety stock only) → lead time falls back',
    perSku: { safetyStock: 50 },
    expected: { leadTimeDays: 14, safetyStock: 50 },
  },
  {
    name: 'override of 0 is honored, NOT treated as unset',
    perSku: { leadTimeDays: 0, safetyStock: 0 },
    expected: { leadTimeDays: 0, safetyStock: 0 },
  },
];

describe('effectiveSetting', () => {
  it.each(cases)('$name', ({ perSku, expected }) => {
    expect(effectiveSetting(perSku, defaults)).toEqual(expected);
  });

  it('does not mutate the inputs', () => {
    const perSku = { leadTimeDays: 5 };
    const localDefaults = { leadTimeDays: 14, safetyStock: 10 };
    effectiveSetting(perSku, localDefaults);
    expect(perSku).toEqual({ leadTimeDays: 5 });
    expect(localDefaults).toEqual({ leadTimeDays: 14, safetyStock: 10 });
  });
});
