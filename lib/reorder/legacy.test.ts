import { describe, expect, it } from 'vitest';
import { classifyLegacy, LEGACY_DEFAULTS } from './legacy';

const NOW = new Date('2026-07-23T00:00:00.000Z');

// Helper: an ISO date N days before NOW.
function daysAgo(days: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

describe('classifyLegacy', () => {
  it('flags a SKU with no sales in the window whose listing is old', () => {
    expect(
      classifyLegacy(
        { openDate: daysAgo(900), lastSoldDate: null },
        LEGACY_DEFAULTS,
        NOW,
      ),
    ).toBe(true);
  });

  it('does not flag a listing created inside the grace period', () => {
    // The whole point: a new listing that has not sold yet is not dead.
    expect(
      classifyLegacy(
        { openDate: daysAgo(100), lastSoldDate: null },
        LEGACY_DEFAULTS,
        NOW,
      ),
    ).toBe(false);
  });

  it('does not flag a SKU that sold recently', () => {
    expect(
      classifyLegacy(
        { openDate: daysAgo(900), lastSoldDate: daysAgo(30) },
        LEGACY_DEFAULTS,
        NOW,
      ),
    ).toBe(false);
  });

  it('flags an old listing whose last sale predates the sales window', () => {
    expect(
      classifyLegacy(
        { openDate: daysAgo(900), lastSoldDate: daysAgo(600) },
        LEGACY_DEFAULTS,
        NOW,
      ),
    ).toBe(true);
  });

  it('does not flag when the listing age is unknown', () => {
    // No open_date means we cannot tell a dead SKU from a new one. Defaulting
    // to "legacy" would hide it; leave it visible for review instead.
    expect(
      classifyLegacy({ openDate: null, lastSoldDate: null }, LEGACY_DEFAULTS, NOW),
    ).toBe(false);
  });

  it('treats a sale exactly at the window edge as still selling', () => {
    expect(
      classifyLegacy(
        { openDate: daysAgo(900), lastSoldDate: daysAgo(LEGACY_DEFAULTS.lookbackDays) },
        LEGACY_DEFAULTS,
        NOW,
      ),
    ).toBe(false);
  });

  it('defaults to 550 days of no sales and a 365-day listing grace period', () => {
    expect(LEGACY_DEFAULTS.lookbackDays).toBe(550);
    expect(LEGACY_DEFAULTS.minListingAgeDays).toBe(365);
  });
});
