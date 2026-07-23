import { describe, expect, it } from 'vitest';
import { recommend, type RecommendInput, type Recommendation } from './recommend';

type OkCase = {
  name: string;
  input: RecommendInput;
  recommendedQty: number;
  reorderPoint: number;
};

const okCases: OkCase[] = [
  {
    name: 'clear reorder needed: usable supply below reorder point',
    input: { usableSupply: 12, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10 },
    recommendedQty: 68,
    reorderPoint: 80,
  },
  {
    name: 'well stocked: usable supply above reorder point',
    input: { usableSupply: 100, dailyDemand: 2, leadTimeDays: 7, safetyStock: 5 },
    recommendedQty: 0,
    reorderPoint: 19,
  },
  {
    name: 'exactly at reorder point',
    input: { usableSupply: 30, dailyDemand: 3, leadTimeDays: 10, safetyStock: 0 },
    recommendedQty: 0,
    reorderPoint: 30,
  },
  {
    name: 'one unit below reorder point',
    input: { usableSupply: 29, dailyDemand: 3, leadTimeDays: 10, safetyStock: 0 },
    recommendedQty: 1,
    reorderPoint: 30,
  },
  {
    name: 'zero demand uses safety stock only',
    input: { usableSupply: 4, dailyDemand: 0, leadTimeDays: 14, safetyStock: 10 },
    recommendedQty: 6,
    reorderPoint: 10,
  },
  {
    name: 'zero demand and well stocked',
    input: { usableSupply: 50, dailyDemand: 0, leadTimeDays: 14, safetyStock: 10 },
    recommendedQty: 0,
    reorderPoint: 10,
  },
  {
    name: 'zero safety stock',
    input: { usableSupply: 10, dailyDemand: 4, leadTimeDays: 7, safetyStock: 0 },
    recommendedQty: 18,
    reorderPoint: 28,
  },
  {
    name: 'zero usable supply with real demand',
    input: { usableSupply: 0, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10 },
    recommendedQty: 80,
    reorderPoint: 80,
  },
  {
    name: 'fractional daily demand rounds order quantity up',
    input: { usableSupply: 3, dailyDemand: 2.5, leadTimeDays: 10, safetyStock: 0 },
    recommendedQty: 22,
    reorderPoint: 25,
  },
  {
    name: 'fractional reorder gap rounds up',
    input: { usableSupply: 0.5, dailyDemand: 0.7, leadTimeDays: 10, safetyStock: 0 },
    recommendedQty: 7,
    reorderPoint: 7,
  },
];

describe('recommend ok cases', () => {
  it.each(okCases)('$name', ({ input, recommendedQty, reorderPoint }) => {
    const out = recommend(input);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.recommendedQty).toBe(recommendedQty);
    expect(out.recommendedQty).toBeGreaterThanOrEqual(0);
    expect(out.reasoning.reorderPoint).toBeCloseTo(reorderPoint, 10);
    expect(out.reasoning.usableSupply).toBe(input.usableSupply);
    expect(out.reasoning.dailyDemand).toBe(input.dailyDemand);
    expect(out.reasoning.leadTimeDays).toBe(input.leadTimeDays);
    expect(out.reasoning.safetyStock).toBe(input.safetyStock);
  });
});

type CoverageCase = {
  name: string;
  input: RecommendInput;
  recommendedQty: number;
  reorderPoint: number;
  targetStock: number;
  orderUpToLevel: number;
};

// (s,S) coverage cases. s = reorder point (WHEN to order); S = coverage target
// (order-up-to). We only reorder once usable supply <= s, then fill to
// max(S, s) so we never order below the trigger.
const coverageCases: CoverageCase[] = [
  {
    name: 'below trigger fills up to the coverage target',
    input: { usableSupply: 50, dailyDemand: 2, leadTimeDays: 30, safetyStock: 20, coverageDays: 90 },
    recommendedQty: 130,
    reorderPoint: 80,
    targetStock: 180,
    orderUpToLevel: 180,
  },
  {
    name: 'above trigger does NOT reorder even when below the coverage target',
    input: { usableSupply: 100, dailyDemand: 2, leadTimeDays: 7, safetyStock: 5, coverageDays: 90 },
    recommendedQty: 0,
    reorderPoint: 19,
    targetStock: 180,
    orderUpToLevel: 180,
  },
  {
    name: 'just below trigger fills to coverage',
    input: { usableSupply: 18, dailyDemand: 2, leadTimeDays: 7, safetyStock: 5, coverageDays: 90 },
    recommendedQty: 162,
    reorderPoint: 19,
    targetStock: 180,
    orderUpToLevel: 180,
  },
  {
    name: 'short coverage vs long lead: floors at the trigger (S < s)',
    input: { usableSupply: 40, dailyDemand: 1, leadTimeDays: 100, safetyStock: 0, coverageDays: 30 },
    recommendedQty: 60,
    reorderPoint: 100,
    targetStock: 30,
    orderUpToLevel: 100,
  },
  {
    name: 'fractional demand rounds the coverage order up',
    input: { usableSupply: 3, dailyDemand: 2.5, leadTimeDays: 10, safetyStock: 0, coverageDays: 30 },
    recommendedQty: 72,
    reorderPoint: 25,
    targetStock: 75,
    orderUpToLevel: 75,
  },
  {
    name: 'coverageDays 0 behaves like the old reorder-point top-up',
    input: { usableSupply: 12, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10, coverageDays: 0 },
    recommendedQty: 68,
    reorderPoint: 80,
    targetStock: 0,
    orderUpToLevel: 80,
  },
];

describe('recommend coverage (s,S) cases', () => {
  it.each(coverageCases)('$name', ({ input, recommendedQty, reorderPoint, targetStock, orderUpToLevel }) => {
    const out = recommend(input);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.recommendedQty).toBe(recommendedQty);
    expect(out.recommendedQty).toBeGreaterThanOrEqual(0);
    expect(out.reasoning.reorderPoint).toBeCloseTo(reorderPoint, 10);
    expect(out.reasoning.targetStock).toBeCloseTo(targetStock, 10);
    expect(out.reasoning.orderUpToLevel).toBeCloseTo(orderUpToLevel, 10);
    expect(out.reasoning.coverageDays).toBe(input.coverageDays ?? 0);
  });
});

type ReviewCase = {
  name: string;
  input: RecommendInput;
  reason: string;
};

const reviewCases: ReviewCase[] = [
  {
    name: 'UNKNOWN usable supply is never a number',
    input: { usableSupply: null, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10 },
    reason: 'unknown-usable-supply',
  },
  {
    name: 'UNKNOWN demand',
    input: { usableSupply: 50, dailyDemand: null, leadTimeDays: 14, safetyStock: 10 },
    reason: 'unknown-demand',
  },
  {
    name: 'both UNKNOWN checks usable supply first',
    input: { usableSupply: null, dailyDemand: null, leadTimeDays: 14, safetyStock: 10 },
    reason: 'unknown-usable-supply',
  },
  {
    name: 'negative usable supply',
    input: { usableSupply: -5, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10 },
    reason: 'invalid-usable-supply',
  },
  {
    name: 'NaN demand',
    input: { usableSupply: 10, dailyDemand: NaN, leadTimeDays: 14, safetyStock: 10 },
    reason: 'invalid-demand',
  },
  {
    name: 'negative lead time',
    input: { usableSupply: 10, dailyDemand: 5, leadTimeDays: -1, safetyStock: 10 },
    reason: 'invalid-lead-time',
  },
  {
    name: 'Infinite safety stock',
    input: { usableSupply: 10, dailyDemand: 5, leadTimeDays: 14, safetyStock: Infinity },
    reason: 'invalid-safety-stock',
  },
  {
    name: 'negative coverage days',
    input: { usableSupply: 10, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10, coverageDays: -1 },
    reason: 'invalid-coverage',
  },
  {
    name: 'NaN coverage days',
    input: { usableSupply: 10, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10, coverageDays: NaN },
    reason: 'invalid-coverage',
  },
];

describe('recommend needs-review cases', () => {
  it.each(reviewCases)('$name', ({ input, reason }) => {
    const out = recommend(input);
    expect(out.status).toBe('needs-review');
    if (out.status !== 'needs-review') return;
    expect(out.reason).toBe(reason);
    expect((out as { recommendedQty?: number }).recommendedQty).toBeUndefined();
  });
});

describe('UNKNOWN usable-supply invariant', () => {
  it('null usable supply is never treated as 0', () => {
    const out: Recommendation = recommend({
      usableSupply: null,
      dailyDemand: 5,
      leadTimeDays: 14,
      safetyStock: 10,
    });
    expect(out.status).toBe('needs-review');
    expect('recommendedQty' in out).toBe(false);
  });

  it('real zero usable supply is distinct from null', () => {
    const zero = recommend({
      usableSupply: 0,
      dailyDemand: 5,
      leadTimeDays: 14,
      safetyStock: 10,
    });
    const unknown = recommend({
      usableSupply: null,
      dailyDemand: 5,
      leadTimeDays: 14,
      safetyStock: 10,
    });
    expect(zero.status).toBe('ok');
    expect(unknown.status).toBe('needs-review');
    if (zero.status === 'ok') expect(zero.recommendedQty).toBe(80);
  });

  it('null demand is never treated as 0 demand', () => {
    const unknownDemand = recommend({
      usableSupply: 4,
      dailyDemand: null,
      leadTimeDays: 14,
      safetyStock: 10,
    });
    const zeroDemand = recommend({
      usableSupply: 4,
      dailyDemand: 0,
      leadTimeDays: 14,
      safetyStock: 10,
    });
    expect(unknownDemand.status).toBe('needs-review');
    expect(zeroDemand.status).toBe('ok');
    if (zeroDemand.status === 'ok') expect(zeroDemand.recommendedQty).toBe(6);
  });
});
