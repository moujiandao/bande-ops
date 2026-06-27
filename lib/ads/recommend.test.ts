import { describe, it, expect } from 'vitest';
import {
  recommendCampaignActions,
  type RecommendInput,
  type Recommendation,
} from './recommend';

// recommendCampaignActions is the decision-support policy layer: it maps a
// campaign's actionable flags (from classifyCampaign) + raw metrics into
// concrete, human-reviewable change recommendations. It NEVER writes — it only
// suggests. The load-bearing invariants mirror classify/metrics:
//   - UNKNOWN (null cost/sales/acos) NEVER produces a recommendation. We only
//     recommend on numbers we actually have, and we re-verify on the raw metrics
//     so a stale/incorrect flag can't trip a pause or a budget cut.
//   - PAUSED / ARCHIVED campaigns get no recommendations (the action — pausing —
//     was already taken; there is nothing left to recommend).
//   - spend-no-sales (real spend, a true zero of sales) -> suggest 'pause'.
//   - high-acos (computed ACOS strictly above target) -> suggest 'lower-budget',
//     with a concrete suggestedBudget ONLY when the current budget is KNOWN.

const base: RecommendInput = {
  state: 'enabled',
  cost: null,
  sales: null,
  dailyBudget: null,
  acosTarget: 0.25,
  flags: [],
};

const input = (over: Partial<RecommendInput>): RecommendInput => ({
  ...base,
  ...over,
});

const kinds = (recs: Recommendation[]): string[] => recs.map((r) => r.kind);

describe('recommendCampaignActions', () => {
  it('spend-no-sales -> recommend pause', () => {
    const recs = recommendCampaignActions(
      input({ cost: 15, sales: 0, flags: ['spend-no-sales'] }),
    );
    expect(kinds(recs)).toEqual(['pause']);
    expect(recs[0].reason).toBeTruthy();
  });

  it('high-acos with a KNOWN budget -> lower-budget WITH a reduced suggestedBudget', () => {
    // 50/100 = 0.5 ACOS > 0.25 target. Budget 20 -> suggest a cut (< 20).
    const recs = recommendCampaignActions(
      input({
        cost: 50,
        sales: 100,
        dailyBudget: 20,
        acosTarget: 0.25,
        flags: ['high-acos'],
      }),
    );
    expect(kinds(recs)).toEqual(['lower-budget']);
    expect(recs[0].suggestedBudget).toBeDefined();
    expect(recs[0].suggestedBudget!).toBeLessThan(20);
    expect(recs[0].suggestedBudget!).toBeGreaterThan(0);
  });

  it('high-acos with an UNKNOWN (null) budget -> lower-budget but NO suggestedBudget', () => {
    // The actionable metric (ACOS) is known, so we still recommend lowering the
    // budget; we just cannot suggest a number when the current budget is UNKNOWN.
    const recs = recommendCampaignActions(
      input({
        cost: 50,
        sales: 100,
        dailyBudget: null,
        acosTarget: 0.25,
        flags: ['high-acos'],
      }),
    );
    expect(kinds(recs)).toEqual(['lower-budget']);
    expect(recs[0].suggestedBudget).toBeUndefined();
  });

  it('both signals -> pause first, then lower-budget (canonical order)', () => {
    // Contrived: cost>0 with a true zero of sales triggers spend-no-sales; but
    // ACOS is null on zero sales so high-acos cannot also fire here. Use a flag
    // set that includes both and rely on raw-metric re-verification to drop the
    // one that isn't actually true. With sales 0, only pause survives.
    const recs = recommendCampaignActions(
      input({
        cost: 50,
        sales: 0,
        dailyBudget: 20,
        acosTarget: 0.25,
        flags: ['high-acos', 'spend-no-sales'],
      }),
    );
    // high-acos can't be real with zero sales (ACOS UNKNOWN) -> dropped.
    expect(kinds(recs)).toEqual(['pause']);
  });

  // --- UNKNOWN-safe --------------------------------------------------------
  it('UNKNOWN cost (null) -> no recommendations even if a flag is present', () => {
    const recs = recommendCampaignActions(
      input({ cost: null, sales: 0, flags: ['spend-no-sales'] }),
    );
    expect(recs).toEqual([]);
  });

  it('UNKNOWN sales (null) -> no recommendations', () => {
    const recs = recommendCampaignActions(
      input({ cost: 50, sales: null, dailyBudget: 20, flags: ['high-acos'] }),
    );
    expect(recs).toEqual([]);
  });

  it('all UNKNOWN + no flags -> no recommendations', () => {
    const recs = recommendCampaignActions(
      input({ cost: null, sales: null, dailyBudget: null, acosTarget: null }),
    );
    expect(recs).toEqual([]);
  });

  it('no flags -> no recommendations even with real numbers', () => {
    // Efficient campaign (ACOS below target, sales present) -> classify emits no
    // flags -> recommend emits nothing.
    const recs = recommendCampaignActions(
      input({ cost: 10, sales: 100, dailyBudget: 20, acosTarget: 0.25, flags: [] }),
    );
    expect(recs).toEqual([]);
  });

  // --- paused-safe ---------------------------------------------------------
  it('PAUSED campaign -> no recommendations even if flags are passed', () => {
    const recs = recommendCampaignActions(
      input({
        state: 'paused',
        cost: 50,
        sales: 0,
        dailyBudget: 20,
        flags: ['spend-no-sales', 'high-acos'],
      }),
    );
    expect(recs).toEqual([]);
  });

  it('ARCHIVED campaign -> no recommendations', () => {
    const recs = recommendCampaignActions(
      input({
        state: 'archived',
        cost: 50,
        sales: 100,
        dailyBudget: 20,
        flags: ['high-acos'],
      }),
    );
    expect(recs).toEqual([]);
  });

  // --- defensive: stale/incorrect flags never trip a write recommendation --
  it('high-acos flag but ACOS actually at/below target -> dropped (re-verified)', () => {
    // 20/100 = 0.2 ACOS, NOT above the 0.25 target -> no lower-budget even
    // though a (stale) high-acos flag was passed.
    const recs = recommendCampaignActions(
      input({ cost: 20, sales: 100, dailyBudget: 20, acosTarget: 0.25, flags: ['high-acos'] }),
    );
    expect(recs).toEqual([]);
  });

  it('does not mutate its input', () => {
    const original = input({ cost: 50, sales: 0, flags: ['spend-no-sales'] });
    const snapshot = JSON.parse(JSON.stringify(original));
    recommendCampaignActions(original);
    expect(original).toEqual(snapshot);
  });
});
