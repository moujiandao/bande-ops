/**
 * Deterministic, network-free DemandProvider for tests and local dev.
 *
 * Lives in its own node-safe file (no `import 'server-only'`) so unit tests and
 * the recommender path can import it directly without pulling in the SP-API
 * provider's server-only taint. See `./demand` for the seam + factory.
 *
 * Canned per-SKU demand. Includes one SKU mapped to `null` to exercise the
 * UNKNOWN-demand path (must surface as needs-review, never as 0). Any SKU not in
 * the table also resolves to `null` (we have no demand window for it).
 */

import type { MarketplaceId } from '@/lib/amazon/types';
import type { DemandProvider } from './demand';

export class FakeDemandProvider implements DemandProvider {
  private readonly bySku: Map<string, number | null>;

  constructor(
    seed: Record<string, number | null> = {
      'BANDE-001': 1.5, // healthy demand signal (fractional, as a real average is)
      'BANDE-002': null, // UNKNOWN demand: no usable window -> needs-review
    },
  ) {
    this.bySku = new Map(Object.entries(seed));
  }

  async getDailyDemand(
    sku: string,
    _marketplaceId: MarketplaceId,
  ): Promise<number | null> {
    // Unseeded SKUs have no demand window -> UNKNOWN (null), never 0.
    return this.bySku.has(sku) ? (this.bySku.get(sku) ?? null) : null;
  }
}
