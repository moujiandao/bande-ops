export interface LegacyPolicy {
  /** No sale within this many days counts as not selling. */
  lookbackDays: number;
  /** Listings younger than this are never legacy, however little they sold. */
  minListingAgeDays: number;
}

export const LEGACY_DEFAULTS: LegacyPolicy = {
  // ~18 months without a sale.
  lookbackDays: 550,
  // A listing created within the last year has not had a fair run yet.
  minListingAgeDays: 365,
};

export interface LegacyInput {
  /** Listing creation date (ISO YYYY-MM-DD), or null when unknown. */
  openDate: string | null;
  /** Most recent date with customer shipments, or null if never sold. */
  lastSoldDate: string | null;
}

function daysBetween(from: string, to: Date): number {
  const parsed = Date.parse(`${from}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return Number.NaN;
  return Math.floor((to.getTime() - parsed) / 86_400_000);
}

/**
 * A SKU is legacy when it has not sold for a long time AND its listing is old
 * enough that the silence is meaningful.
 *
 * Both halves matter. Without the age check a listing created last month looks
 * identical to one dead for years, and would be hidden before it ever had a
 * chance to sell. An unknown open date is never legacy: we cannot tell the two
 * apart, and hiding a SKU we cannot classify is worse than showing it.
 */
export function classifyLegacy(
  input: LegacyInput,
  policy: LegacyPolicy = LEGACY_DEFAULTS,
  now: Date = new Date(),
): boolean {
  if (!input.openDate) return false;

  const listingAge = daysBetween(input.openDate, now);
  if (Number.isNaN(listingAge) || listingAge < policy.minListingAgeDays) {
    return false;
  }

  if (!input.lastSoldDate) return true;

  const daysSinceSale = daysBetween(input.lastSoldDate, now);
  if (Number.isNaN(daysSinceSale)) return false;

  return daysSinceSale > policy.lookbackDays;
}
