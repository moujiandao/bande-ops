import { describe, it, expect } from 'vitest';
import { classifyCampaign, type ClassifyInput, type CampaignFlag } from './classify';

// classifyCampaign turns a campaign's spend picture into actionable flags. The
// load-bearing invariants:
//   - UNKNOWN (null cost/sales/budget/target) NEVER yields a false 'high-acos'
//     or 'spend-no-sales'. We only flag on numbers we actually have.
//   - flags are only emitted for ENABLED campaigns (actionability gate).
//   - a true 0 is distinct from UNKNOWN (0 sales with spend -> spend-no-sales).

const base: ClassifyInput = {
  state: 'enabled',
  cost: null,
  sales: null,
  dailyBudget: null,
  acosTarget: 0.25,
};

const input = (over: Partial<ClassifyInput>): ClassifyInput => ({ ...base, ...over });

const cases: Array<{ name: string; input: ClassifyInput; expect: CampaignFlag[] }> = [
  // --- high-acos -----------------------------------------------------------
  {
    name: 'ACOS above target (both known) -> high-acos',
    // 50/100 = 0.5 ratio > 0.25 target. budget null so underspending can't fire.
    input: input({ cost: 50, sales: 100, acosTarget: 0.25 }),
    expect: ['high-acos'],
  },
  {
    name: 'ACOS below target -> no flag',
    input: input({ cost: 10, sales: 100, acosTarget: 0.25 }),
    expect: [],
  },
  {
    name: 'ACOS exactly equal to target is NOT above -> no flag',
    input: input({ cost: 25, sales: 100, acosTarget: 0.25 }),
    expect: [],
  },
  {
    name: 'target UNKNOWN (null) -> never high-acos even when ACOS is huge',
    input: input({ cost: 90, sales: 100, acosTarget: null }),
    expect: [],
  },
  // --- spend-no-sales ------------------------------------------------------
  {
    name: 'spend with a true zero of sales -> spend-no-sales',
    // budget null so only the wasted-spend flag fires.
    input: input({ cost: 10, sales: 0, dailyBudget: null }),
    expect: ['spend-no-sales'],
  },
  // --- underspending -------------------------------------------------------
  {
    name: 'enabled, budget set, barely spending -> underspending',
    // cost 10 < 100*0.25=25; ACOS 10/1000=0.01 < target so no high-acos.
    input: input({ cost: 10, sales: 1000, dailyBudget: 100, acosTarget: 0.25 }),
    expect: ['underspending'],
  },
  {
    name: 'enabled, budget set, zero spend -> underspending only (not spend-no-sales)',
    input: input({ cost: 0, sales: 0, dailyBudget: 100, acosTarget: 0.25 }),
    expect: ['underspending'],
  },
  {
    name: 'spending above the underspend floor -> no underspending',
    input: input({ cost: 80, sales: 1000, dailyBudget: 100, acosTarget: 0.25 }),
    expect: [],
  },
  // --- combined ------------------------------------------------------------
  {
    name: 'spend, zero sales, and underspending all at once (canonical order)',
    // cost 10 > 0 & sales 0 -> spend-no-sales; cost 10 < 25 -> underspending;
    // ACOS is null (zero sales) so no high-acos.
    input: input({ cost: 10, sales: 0, dailyBudget: 100, acosTarget: 0.25 }),
    expect: ['spend-no-sales', 'underspending'],
  },
  // --- UNKNOWN data must not produce false flags ---------------------------
  {
    name: 'UNKNOWN cost (null) -> no high-acos, no spend-no-sales, no underspending',
    input: input({ cost: null, sales: 0, dailyBudget: 100, acosTarget: 0.25 }),
    expect: [],
  },
  {
    name: 'UNKNOWN sales (null) -> no high-acos (ACOS null) and no spend-no-sales',
    input: input({ cost: 50, sales: null, dailyBudget: null, acosTarget: 0.25 }),
    expect: [],
  },
  {
    name: 'UNKNOWN budget (null) -> no underspending even with tiny spend',
    input: input({ cost: 1, sales: 1000, dailyBudget: null, acosTarget: 0.25 }),
    expect: [],
  },
  {
    name: 'all UNKNOWN -> no flags',
    input: input({ cost: null, sales: null, dailyBudget: null, acosTarget: null }),
    expect: [],
  },
  {
    name: 'non-finite cost (NaN) -> no flags (never leaks into a comparison)',
    input: input({ cost: Number.NaN, sales: 100, dailyBudget: 100, acosTarget: 0.25 }),
    expect: [],
  },
  // --- actionability gate (state) -----------------------------------------
  {
    name: 'PAUSED campaign with high ACOS + zero-sale spend -> no flags',
    input: input({ state: 'paused', cost: 90, sales: 0, dailyBudget: 100, acosTarget: 0.25 }),
    expect: [],
  },
  {
    name: 'ARCHIVED campaign -> no flags',
    input: input({ state: 'archived', cost: 90, sales: 100, dailyBudget: 100, acosTarget: 0.25 }),
    expect: [],
  },
];

describe('classifyCampaign', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(classifyCampaign(c.input)).toEqual(c.expect);
    });
  }

  it('does not mutate its input', () => {
    const original = input({ cost: 50, sales: 100, dailyBudget: 100 });
    const snapshot = { ...original };
    classifyCampaign(original);
    expect(original).toEqual(snapshot);
  });
});
