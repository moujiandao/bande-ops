import { describe, expect, it } from 'vitest';
import { buildLedgerReportBody } from './reports';

describe('buildLedgerReportBody', () => {
  it('builds the approved daily ledger summary report request', () => {
    expect(
      buildLedgerReportBody({
        marketplaceId: 'ATVPDKIKX0DER',
        dataStartTime: '2025-07-21T00:00:00.000Z',
        dataEndTime: '2026-07-21T00:00:00.000Z',
      }),
    ).toEqual({
      reportType: 'GET_LEDGER_SUMMARY_VIEW_DATA',
      marketplaceIds: ['ATVPDKIKX0DER'],
      dataStartTime: '2025-07-21T00:00:00.000Z',
      dataEndTime: '2026-07-21T00:00:00.000Z',
      reportOptions: {
        aggregateByLocation: 'COUNTRY',
        aggregatedByTimePeriod: 'DAILY',
      },
    });
  });
});
