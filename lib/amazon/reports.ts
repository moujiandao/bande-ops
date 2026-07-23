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
