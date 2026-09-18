export type ReportProcessingStatus =
  | 'IN_QUEUE'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'FATAL'
  | 'CANCELLED';

export interface ReportStatus {
  reportId: string;
  processingStatus: ReportProcessingStatus;
  reportDocumentId?: string;
}

export interface ReportDocument {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: 'GZIP';
}

export type ShipmentEvidenceReportKind = 'sales' | 'promotions';

/** Bounded requests for the two explicitly approved, non-restricted reports. */
export function buildShipmentEvidenceReportBody(input: {
  kind: ShipmentEvidenceReportKind;
  marketplaceId: string;
  dataStartTime: string;
  dataEndTime: string;
}) {
  if (input.kind !== 'sales' && input.kind !== 'promotions') {
    throw new Error('Unsupported shipment evidence report.');
  }
  const start = Date.parse(input.dataStartTime);
  const end = Date.parse(input.dataEndTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
      end - start > 31 * 86_400_000) {
    throw new Error('Shipment evidence requires a valid range of at most 31 days.');
  }
  return {
    reportType: input.kind === 'sales'
      ? 'GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA'
      : 'GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_PROMOTION_DATA',
    marketplaceIds: [input.marketplaceId],
    dataStartTime: input.dataStartTime,
    dataEndTime: input.dataEndTime,
  };
}

/**
 * All merchant listings, active and inactive. This is the only source for a
 * listing's `open-date`, which distinguishes a genuinely dead SKU from one
 * created recently that simply has not sold yet. Unlike the ledger it takes no
 * date range — it is a snapshot of every listing.
 */
export function buildMerchantListingsReportBody(input: {
  marketplaceId: string;
}) {
  return {
    reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
    marketplaceIds: [input.marketplaceId],
  };
}

export function buildLedgerReportBody(input: {
  marketplaceId: string;
  dataStartTime: string;
  dataEndTime: string;
}) {
  return {
    reportType: 'GET_LEDGER_SUMMARY_VIEW_DATA',
    marketplaceIds: [input.marketplaceId],
    dataStartTime: input.dataStartTime,
    dataEndTime: input.dataEndTime,
    reportOptions: {
      aggregateByLocation: 'COUNTRY',
      aggregatedByTimePeriod: 'DAILY',
    },
  };
}
