import { describe, it, expect } from 'vitest';
import { recommend, type RecommendInput, type Recommendation } from './recommend';

// The pure recommender is the highest-stakes logic in the app: a wrong number is
// a wrong purchase order. These table-driven cases pin every branch of the
// reorder-point math AND the non-negotiable invariant carried from
// supplier-reorder: UNKNOWN (null) on-hand or demand is NEVER a number — it is
// surfaced as needs-review, and null is NEVER folded in as 0.

type OkCase = {
  name: string;
  input: RecommendInput;
  recommendedQty: number;
  reorderPoint: number;
};

// reorderPoint = dailyDemand*leadTimeDays + safetyStock
// recommendedQty = onHand <= reorderPoint ? ceil(reorderPoint - onHand) : 0
const okCases: OkCase[] = [
  {
    name: 'clear reorder needed: on-hand well below the reorder point',
    // ROP = 5*14 + 10 = 80; 12 <= 80 -> 80 - 12 = 68
    input: { onHand: 12, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10 },
    recommendedQty: 68,
    reorderPoint: 80,
  },
  {
    name: 'well-stocked: on-hand above the reorder point -> 0',
    // ROP = 2*7 + 5 = 19; 100 > 19 -> 0
    input: { onHand: 100, dailyDemand: 2, leadTimeDays: 7, safetyStock: 5 },
    recommendedQty: 0,
    reorderPoint: 19,
  },
  {
    name: 'exactly at the reorder point -> 0 (boundary is <=, qty is 0)',
    // ROP = 3*10 + 0 = 30; 30 <= 30 -> 30 - 30 = 0
    input: { onHand: 30, dailyDemand: 3, leadTimeDays: 10, safetyStock: 0 },
    recommendedQty: 0,
    reorderPoint: 30,
  },
  {
    name: 'one unit below the reorder point -> orders 1',
    // ROP = 3*10 + 0 = 30; 29 <= 30 -> 1
    input: { onHand: 29, dailyDemand: 3, leadTimeDays: 10, safetyStock: 0 },
    recommendedQty: 1,
    reorderPoint: 30,
  },
  {
    name: 'zero demand: reorder point is just the safety stock',
    // ROP = 0*14 + 10 = 10; 4 <= 10 -> 6
    input: { onHand: 4, dailyDemand: 0, leadTimeDays: 14, safetyStock: 10 },
    recommendedQty: 6,
    reorderPoint: 10,
  },
  {
    name: 'zero demand AND well stocked -> 0',
    // ROP = 0*14 + 10 = 10; 50 > 10 -> 0
    input: { onHand: 50, dailyDemand: 0, leadTimeDays: 14, safetyStock: 10 },
    recommendedQty: 0,
    reorderPoint: 10,
  },
  {
    name: 'zero safety stock: reorder point is pure lead-time demand',
    // ROP = 4*7 + 0 = 28; 10 <= 28 -> 18
    input: { onHand: 10, dailyDemand: 4, leadTimeDays: 7, safetyStock: 0 },
    recommendedQty: 18,
    reorderPoint: 28,
  },
  {
    name: 'zero on-hand with real demand -> orders the full reorder point',
    // ROP = 5*14 + 10 = 80; 0 <= 80 -> 80
    input: { onHand: 0, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10 },
    recommendedQty: 80,
    reorderPoint: 80,
  },
  {
    name: 'fractional daily demand: order quantity rounds UP (never under-order)',
    // ROP = 2.5*10 + 0 = 25; 3 <= 25 -> ceil(25 - 3) = ceil(22) = 22
    input: { onHand: 3, dailyDemand: 2.5, leadTimeDays: 10, safetyStock: 0 },
    recommendedQty: 22,
    reorderPoint: 25,
  },
  {
    name: 'fractional reorder-point gap rounds UP',
    // ROP = 0.7*10 + 0 = 7; 0.5 <= 7 -> ceil(6.5) = 7
    input: { onHand: 0.5, dailyDemand: 0.7, leadTimeDays: 10, safetyStock: 0 },
    recommendedQty: 7,
    reorderPoint: 7,
  },
];

describe('recommend — ok (numeric) cases', () => {
  it.each(okCases)('$name', ({ input, recommendedQty, reorderPoint }) => {
    const out = recommend(input);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return; // narrow for TS
    expect(out.recommendedQty).toBe(recommendedQty);
    expect(out.recommendedQty).toBeGreaterThanOrEqual(0);
    expect(out.reasoning.reorderPoint).toBeCloseTo(reorderPoint, 10);
    // Reasoning echoes the exact inputs so the UI can show the "why".
    expect(out.reasoning.onHand).toBe(input.onHand);
    expect(out.reasoning.dailyDemand).toBe(input.dailyDemand);
    expect(out.reasoning.leadTimeDays).toBe(input.leadTimeDays);
    expect(out.reasoning.safetyStock).toBe(input.safetyStock);
  });
});

type ReviewCase = {
  name: string;
  input: RecommendInput;
  reason: string;
};

const reviewCases: ReviewCase[] = [
  {
    name: 'UNKNOWN on-hand (null) -> needs-review, never a number',
    input: { onHand: null, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10 },
    reason: 'unknown-on-hand',
  },
  {
    name: 'UNKNOWN demand (null) -> needs-review',
    input: { onHand: 50, dailyDemand: null, leadTimeDays: 14, safetyStock: 10 },
    reason: 'unknown-demand',
  },
  {
    name: 'both UNKNOWN -> needs-review (on-hand checked first)',
    input: { onHand: null, dailyDemand: null, leadTimeDays: 14, safetyStock: 10 },
    reason: 'unknown-on-hand',
  },
  {
    name: 'negative on-hand -> needs-review (guarded, not a number)',
    input: { onHand: -5, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10 },
    reason: 'invalid-on-hand',
  },
  {
    name: 'NaN demand -> needs-review',
    input: { onHand: 10, dailyDemand: NaN, leadTimeDays: 14, safetyStock: 10 },
    reason: 'invalid-demand',
  },
  {
    name: 'negative lead time -> needs-review',
    input: { onHand: 10, dailyDemand: 5, leadTimeDays: -1, safetyStock: 10 },
    reason: 'invalid-lead-time',
  },
  {
    name: 'Infinite safety stock -> needs-review',
    input: { onHand: 10, dailyDemand: 5, leadTimeDays: 14, safetyStock: Infinity },
    reason: 'invalid-safety-stock',
  },
];

describe('recommend — needs-review cases', () => {
  it.each(reviewCases)('$name', ({ input, reason }) => {
    const out = recommend(input);
    expect(out.status).toBe('needs-review');
    if (out.status !== 'needs-review') return; // narrow for TS
    expect(out.reason).toBe(reason);
    // A needs-review result carries NO recommendedQty field at all.
    expect((out as { recommendedQty?: number }).recommendedQty).toBeUndefined();
  });
});

describe('UNKNOWN-stock invariant (the money-critical rule)', () => {
  it('null on-hand is NEVER treated as 0: it yields needs-review, not a 0-or-larger quantity', () => {
    const out: Recommendation = recommend({
      onHand: null,
      dailyDemand: 5,
      leadTimeDays: 14,
      safetyStock: 10,
    });
    expect(out.status).toBe('needs-review');
    // Explicitly prove it did NOT take the onHand===0 path (which would have
    // recommended the full reorder point of 80) nor produce any number.
    expect('recommendedQty' in out).toBe(false);
  });

  it('contrast: a TRUE 0 on-hand IS a number (80), so null and 0 are not conflated', () => {
    const zero = recommend({ onHand: 0, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10 });
    const unknown = recommend({ onHand: null, dailyDemand: 5, leadTimeDays: 14, safetyStock: 10 });
    expect(zero.status).toBe('ok');
    expect(unknown.status).toBe('needs-review');
    if (zero.status === 'ok') expect(zero.recommendedQty).toBe(80);
  });

  it('null demand is NEVER treated as 0 demand: needs-review, not reorderPoint=safetyStock', () => {
    const unknownDemand = recommend({
      onHand: 4,
      dailyDemand: null,
      leadTimeDays: 14,
      safetyStock: 10,
    });
    const zeroDemand = recommend({
      onHand: 4,
      dailyDemand: 0,
      leadTimeDays: 14,
      safetyStock: 10,
    });
    expect(unknownDemand.status).toBe('needs-review');
    // Zero demand is a real, computable case (ROP = safety stock).
    expect(zeroDemand.status).toBe('ok');
    if (zeroDemand.status === 'ok') expect(zeroDemand.recommendedQty).toBe(6);
  });
});
