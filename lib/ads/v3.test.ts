import { describe, it, expect } from 'vitest';
import { parseV3State, parseV3Budget, parseV3Campaign } from './v3';
import type { Campaign } from './types';

// The v3 parsers are the load-bearing seam between the Sponsored Products v3
// API wire shape and our normalized `Campaign`. v3 differs from the deprecated
// v2 in two ways these tests pin: state is UPPERCASE, and the daily budget is a
// NESTED object ({ budget: { budget, budgetType } }) rather than a top-level
// `dailyBudget`. The non-negotiable invariant: an absent/non-numeric budget is
// UNKNOWN (null), NEVER 0.

describe('parseV3State', () => {
  const cases: Array<[string, Campaign['state']]> = [
    ['ENABLED', 'enabled'],
    ['PAUSED', 'paused'],
    ['ARCHIVED', 'archived'],
    // case-insensitive
    ['enabled', 'enabled'],
    ['Paused', 'paused'],
    ['ArChIvEd', 'archived'],
  ];

  it.each(cases)('maps v3 state %s -> %s', (raw, expected) => {
    expect(parseV3State(raw)).toBe(expected);
  });

  const unknowns: Array<[string, string]> = [
    ['empty string', ''],
    ['garbage', 'WHO_KNOWS'],
    ['draft-like', 'DRAFT'],
  ];

  it.each(unknowns)(
    'maps unknown state (%s) to the safe non-spending default: paused',
    (_label, raw) => {
      expect(parseV3State(raw)).toBe('paused');
    },
  );

  it('maps missing/undefined state to paused', () => {
    // @ts-expect-error exercising the runtime guard for missing input
    expect(parseV3State(undefined)).toBe('paused');
    // @ts-expect-error exercising the runtime guard for null input
    expect(parseV3State(null)).toBe('paused');
  });
});

describe('parseV3Budget', () => {
  it('extracts the daily budget number from the nested v3 budget object', () => {
    expect(parseV3Budget({ budget: 25, budgetType: 'DAILY' })).toBe(25);
  });

  it('extracts a true 0 budget as 0 (distinct from UNKNOWN)', () => {
    expect(parseV3Budget({ budget: 0, budgetType: 'DAILY' })).toBe(0);
  });

  const unknownBudgets: Array<[string, unknown]> = [
    ['absent budget object', undefined],
    ['null budget object', null],
    ['empty budget object', {}],
    ['non-numeric budget value', { budget: 'NaN', budgetType: 'DAILY' }],
    ['null budget value', { budget: null, budgetType: 'DAILY' }],
    ['NaN budget value', { budget: Number.NaN, budgetType: 'DAILY' }],
    ['Infinity budget value', { budget: Number.POSITIVE_INFINITY }],
  ];

  it.each(unknownBudgets)(
    'maps %s to UNKNOWN (null), NEVER 0',
    (_label, input) => {
      const result = parseV3Budget(input);
      expect(result).toBeNull();
      expect(result).not.toBe(0);
    },
  );

  it('treats a non-daily budget type (e.g. LIFETIME) as UNKNOWN, not a daily figure', () => {
    expect(parseV3Budget({ budget: 500, budgetType: 'LIFETIME' })).toBeNull();
  });

  it('treats an absent budgetType as DAILY (the SP default)', () => {
    expect(parseV3Budget({ budget: 25 })).toBe(25);
  });
});

describe('parseV3Campaign', () => {
  it('parses a full v3 campaign object into a normalized Campaign', () => {
    const raw = {
      campaignId: 123456789,
      name: 'Bande SP — Brand Defense',
      state: 'ENABLED',
      budget: { budget: 25, budgetType: 'DAILY' },
    };

    expect(parseV3Campaign(raw)).toEqual<Campaign>({
      campaignId: '123456789',
      name: 'Bande SP — Brand Defense',
      state: 'enabled',
      dailyBudget: 25,
    });
  });

  it('stringifies a numeric campaignId and preserves UNKNOWN budget as null', () => {
    const raw = {
      campaignId: 222222222,
      name: 'Bande SP — Legacy Import',
      state: 'PAUSED',
      // no budget object at all
    };

    expect(parseV3Campaign(raw)).toEqual<Campaign>({
      campaignId: '222222222',
      name: 'Bande SP — Legacy Import',
      state: 'paused',
      dailyBudget: null,
    });
  });

  it('defaults a missing/unknown state to paused and a missing id/name to empty string', () => {
    expect(parseV3Campaign({})).toEqual<Campaign>({
      campaignId: '',
      name: '',
      state: 'paused',
      dailyBudget: null,
    });
  });
});
