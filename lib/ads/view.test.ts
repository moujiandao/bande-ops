import { describe, it, expect } from 'vitest';
import {
  searchCampaigns,
  sortBySpend,
  sortByAcos,
  type SearchableCampaign,
} from './view';

// Pure helpers behind the ads table's search + sort UX. The load-bearing
// invariant lives in the sorts: an UNKNOWN (null) spend or ACOS must NOT be
// treated as 0 — it sorts to the end, never to the front of a lowest-first view.

describe('searchCampaigns', () => {
  const rows: SearchableCampaign[] = [
    { name: 'Brand Defense', state: 'enabled' },
    { name: 'Auto Discovery', state: 'paused' },
    { name: 'Holiday Push', state: 'archived' },
  ];

  const cases: Array<{ name: string; query: string; expect: string[] }> = [
    {
      name: 'empty query returns all rows (no filter)',
      query: '',
      expect: ['Brand Defense', 'Auto Discovery', 'Holiday Push'],
    },
    {
      name: 'whitespace-only query returns all rows',
      query: '   ',
      expect: ['Brand Defense', 'Auto Discovery', 'Holiday Push'],
    },
    {
      name: 'matches on name, case-insensitively',
      query: 'brand',
      expect: ['Brand Defense'],
    },
    {
      name: 'matches on state',
      query: 'paused',
      expect: ['Auto Discovery'],
    },
    {
      name: 'trims surrounding whitespace before matching',
      query: '  holiday  ',
      expect: ['Holiday Push'],
    },
    {
      name: 'no match returns empty',
      query: 'nonexistent',
      expect: [],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(searchCampaigns(rows, c.query).map((r) => r.name)).toEqual(c.expect);
    });
  }

  it('preserves the caller row type (generic passthrough)', () => {
    const tagged = [{ name: 'Keep', state: 'enabled', extra: 42 }];
    expect(searchCampaigns(tagged, 'keep')[0].extra).toBe(42);
  });

  it('does not mutate the input array', () => {
    const input = [...rows];
    searchCampaigns(input, 'brand');
    expect(input).toEqual(rows);
  });
});

describe('sortBySpend', () => {
  const make = (cost: number | null) => ({ cost });

  it('asc orders known spend lowest first', () => {
    const result = sortBySpend([make(5), make(0), make(12)], 'asc');
    expect(result.map((r) => r.cost)).toEqual([0, 5, 12]);
  });

  it('desc orders known spend highest first', () => {
    const result = sortBySpend([make(5), make(0), make(12)], 'desc');
    expect(result.map((r) => r.cost)).toEqual([12, 5, 0]);
  });

  it('UNKNOWN (null) is NOT treated as 0: it sorts to the END in asc', () => {
    const result = sortBySpend([make(null), make(3), make(0)], 'asc');
    expect(result.map((r) => r.cost)).toEqual([0, 3, null]);
    expect(result[0].cost).not.toBeNull();
  });

  it('UNKNOWN (null) also sorts to the END in desc (not as highest)', () => {
    const result = sortBySpend([make(null), make(3), make(0)], 'desc');
    expect(result.map((r) => r.cost)).toEqual([3, 0, null]);
    expect(result[result.length - 1].cost).toBeNull();
  });

  it('a true 0 sorts ahead of UNKNOWN — the two stay distinguishable', () => {
    const result = sortBySpend([make(null), make(0)], 'asc');
    expect(result.map((r) => r.cost)).toEqual([0, null]);
  });

  it('does not mutate the input array', () => {
    const input = [make(5), make(1)];
    const snapshot = input.map((r) => r.cost);
    sortBySpend(input, 'asc');
    expect(input.map((r) => r.cost)).toEqual(snapshot);
  });
});

describe('sortByAcos', () => {
  const make = (acos: number | null, id?: string) => ({ acos, id });

  it('asc orders known ACOS lowest (best) first', () => {
    const result = sortByAcos([make(0.5), make(0.1), make(0.3)], 'asc');
    expect(result.map((r) => r.acos)).toEqual([0.1, 0.3, 0.5]);
  });

  it('desc orders known ACOS highest (worst) first', () => {
    const result = sortByAcos([make(0.5), make(0.1), make(0.3)], 'desc');
    expect(result.map((r) => r.acos)).toEqual([0.5, 0.3, 0.1]);
  });

  it('UNKNOWN ACOS (null) sorts to the END in asc, never as best', () => {
    const result = sortByAcos([make(null), make(0.2), make(0)], 'asc');
    expect(result.map((r) => r.acos)).toEqual([0, 0.2, null]);
  });

  it('UNKNOWN ACOS (null) also sorts to the END in desc', () => {
    const result = sortByAcos([make(null), make(0.2), make(0)], 'desc');
    expect(result.map((r) => r.acos)).toEqual([0.2, 0, null]);
  });

  it('keeps multiple UNKNOWN rows together at the end, stably', () => {
    const result = sortByAcos(
      [make(null, 'a'), make(0.7, 'b'), make(null, 'c')],
      'asc',
    );
    expect(result.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
});
