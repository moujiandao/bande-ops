/**
 * Real SP-API demand provider — SKELETON ONLY (live fetch gated on SP-API creds
 * we do not have yet). `import 'server-only'` so it can never be bundled to the
 * browser and never loads in a node unit test (which is why the Fake lives in a
 * separate file and tests import that one directly).
 *
 * Intended implementation (FBA Inventory Ledger via SP-API Reports API):
 *   1. POST /reports/2021-06-30/reports with reportType
 *      GET_LEDGER_DETAIL_VIEW_DATA (or GET_LEDGER_SUMMARY_VIEW_DATA) over a
 *      dataStartTime..dataEndTime window (the demand lookback, e.g. last 90d).
 *   2. Poll GET /reports/{reportId} until processingStatus === 'DONE', then
 *      GET /documents/{reportDocumentId} and stream/decompress the TSV.
 *   3. For the SKU (MSKU), sum the aggregate "units shipped" / customer-shipment
 *      movements across the window. Divide by the window length in days ->
 *      average daily demand. PII-free: this is an aggregate movements report,
 *      NOT Orders / buyer data (no Restricted Data Token).
 *      NOTE (carried from supplier-reorder): ledger ids can be truncated/variant
 *      forms of the SKU (e.g. a shortened MSKU). Reconcile ledger rows back to the
 *      canonical catalog SKU before summing, or demand maps to the wrong item.
 *      This reconciliation is deferred to this provider (creds-gated), not the
 *      pure recommender.
 *   4. No usable window (SKU absent / zero-length window) -> return null
 *      (UNKNOWN), NEVER 0.
 */

import 'server-only';

import type { MarketplaceId } from '@/lib/amazon/types';
import type { DemandProvider } from './demand';

export class SpApiDemandProvider implements DemandProvider {
  async getDailyDemand(
    _sku: string,
    _marketplaceId: MarketplaceId,
  ): Promise<number | null> {
    // TODO(creds): implement the FBA Inventory Ledger pull described above once
    // SP-API credentials are available. Until then this is a hard skeleton: it
    // must NOT silently return 0 (that would skew the reorder point). Throw so a
    // mis-wired production path fails loud instead of fabricating demand.
    throw new Error(
      'SpApiDemandProvider.getDailyDemand: not implemented (gated on SP-API ' +
        'creds). Set AMAZON_USE_FAKE=true to use FakeDemandProvider.',
    );
  }
}
