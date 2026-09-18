import { describe, expect, it } from 'vitest';
import { buildLedgerReportBody, buildShipmentEvidenceReportBody, type ShipmentEvidenceReportKind } from './reports';

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

describe('shipment evidence request boundaries', () => {
  const range = { marketplaceId: 'ATVPDKIKX0DER', dataStartTime: '2026-08-18T00:00:00.000Z', dataEndTime: '2026-09-17T00:00:00.000Z' };

  it.each([
    ['sales', 'GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA'],
    ['promotions', 'GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_PROMOTION_DATA'],
  ] as const)('limits %s requests to the approved report type and marketplace', (kind, reportType) => {
    const body = buildShipmentEvidenceReportBody({ ...range, kind });
    expect(body.reportType).toBe(reportType);
    expect(body.marketplaceIds).toEqual(['ATVPDKIKX0DER']);
    expect(body.dataStartTime).toBe(range.dataStartTime);
    expect(body.dataEndTime).toBe(range.dataEndTime);
  });

  it.each([
    { dataStartTime: 'invalid' },
    { dataEndTime: '2026-08-18T00:00:00.000Z' },
    { dataEndTime: '2026-08-01T00:00:00.000Z' },
    { dataEndTime: '2026-10-01T00:00:00.000Z' },
  ])('rejects invalid or unbounded date ranges before transport', (overrides) => {
    expect(() => buildShipmentEvidenceReportBody({ ...range, kind: 'sales', ...overrides })).toThrow('at most 31 days');
  });

  it('rejects an unapproved report kind rather than falling back', () => {
    expect(() => buildShipmentEvidenceReportBody({ ...range, kind: 'orders' as ShipmentEvidenceReportKind })).toThrow('Unsupported');
  });
});
