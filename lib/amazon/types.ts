/**
 * Marketplace + domain shapes for the Amazon SP-API client.
 *
 * UNKNOWN-stock convention:
 *   When Amazon reports a quantity as non-numeric or unavailable, callers MUST
 *   surface it as `totalQuantity: null` (UNKNOWN). null is semantically distinct
 *   from a true 0 — it means "Amazon did not give us a number," is flagged for
 *   review, and must never be folded into reorder math as 0. (See CONTEXT.md
 *   "Unknown stock" and CLAUDE.md "Do Not".)
 */

/** Branded Amazon marketplace id (e.g. 'ATVPDKIKX0DER' for US). */
export type MarketplaceId = string & { readonly __brand: 'MarketplaceId' };

const asMarketplaceId = (value: string): MarketplaceId => value as MarketplaceId;

export interface Marketplace {
  /** Human-readable key, e.g. 'US'. */
  readonly key: string;
  /** Amazon marketplace id. */
  readonly id: MarketplaceId;
  /** Country code (ISO 3166-1 alpha-2). */
  readonly countryCode: string;
  /** SP-API production host for this marketplace's region. */
  readonly host: string;
  /** SP-API sandbox host for this marketplace's region. */
  readonly sandboxHost: string;
}

/**
 * Supported marketplaces. US only is exercised in logic today, but the
 * dimension exists from day one (schema/types carry marketplace).
 */
export const MARKETPLACES: Record<string, Marketplace> = {
  US: {
    key: 'US',
    id: asMarketplaceId('ATVPDKIKX0DER'),
    countryCode: 'US',
    host: 'sellingpartnerapi-na.amazon.com',
    sandboxHost: 'sandbox.sellingpartnerapi-na.amazon.com',
  },
} as const;

/** Default marketplace for all logic (US). */
export const DEFAULT_MARKETPLACE: Marketplace = MARKETPLACES.US;

/** Minimal catalog item shape (PII-free). */
export interface CatalogItem {
  sku: string;
  asin: string;
  title: string;
  imageUrl?: string;
}

/**
 * Inventory summary for a SKU in a marketplace.
 *
 * `totalQuantity: null` means UNKNOWN (Amazon reported non-numeric/unavailable).
 * Never represent UNKNOWN as 0.
 */
export interface InventorySummary {
  sku: string;
  marketplaceId: MarketplaceId;
  /** null = UNKNOWN (see UNKNOWN-stock convention above). */
  totalQuantity: number | null;
  fnSku?: string;
  fulfillableQuantity?: number | null;
  inboundWorkingQuantity?: number | null;
  inboundShippedQuantity?: number | null;
  inboundReceivingQuantity?: number | null;
  reservedQuantity?: number | null;
  researchingQuantity?: number | null;
  unfulfillableQuantity?: number | null;
}

export interface AwdInventorySummary {
  sku: string;
  marketplaceId: MarketplaceId;
  fnSku?: string;
  replenishmentQuantity: number | null;
  totalQuantity: number | null;
}
