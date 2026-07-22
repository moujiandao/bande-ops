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
