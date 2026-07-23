import { describe, expect, it } from 'vitest';
import {
  buildCatalogSkuIndex,
  reconcileLedgerSku,
  reconcileVelocityRows,
} from './reconcile-sku';

describe('reconcileLedgerSku', () => {
  it('passes an exact catalog SKU through unchanged', () => {
    const index = buildCatalogSkuIndex([{ sku: 'WIDGET-BLUE-001' }]);
    expect(reconcileLedgerSku('WIDGET-BLUE-001', null, index)).toBe(
      'WIDGET-BLUE-001',
    );
  });

  it('canonicalizes a truncated MSKU that is a unique prefix of one catalog SKU', () => {
    const index = buildCatalogSkuIndex([
      { sku: 'WIDGET-BLUE-LONG-CANONICAL-0001' },
      { sku: 'GADGET-RED-0002' },
    ]);
    // Amazon truncated the long MSKU in the ledger report.
    expect(reconcileLedgerSku('WIDGET-BLUE-LONG-CAN', null, index)).toBe(
      'WIDGET-BLUE-LONG-CANONICAL-0001',
    );
  });

  it('leaves the raw MSKU when the prefix matches 2+ catalog SKUs (ambiguous)', () => {
    const index = buildCatalogSkuIndex([
      { sku: 'WIDGET-BLUE-CANONICAL-0001' },
      { sku: 'WIDGET-BLUE-CANONICAL-0002' },
    ]);
    expect(reconcileLedgerSku('WIDGET-BLUE-CAN', null, index)).toBe(
      'WIDGET-BLUE-CAN',
    );
  });

  it('leaves the raw MSKU when nothing matches', () => {
    const index = buildCatalogSkuIndex([{ sku: 'GADGET-RED-0002' }]);
    expect(reconcileLedgerSku('WIDGET-BLUE-TRUNC', null, index)).toBe(
      'WIDGET-BLUE-TRUNC',
    );
  });

  it('resolves via FNSKU cross-reference when the MSKU is truncated', () => {
    const index = buildCatalogSkuIndex([
      { sku: 'WIDGET-BLUE-CANONICAL-0001', fnSku: 'X001ABCDEF' },
      { sku: 'WIDGET-BLUE-CANONICAL-0002', fnSku: 'X002GHIJKL' },
    ]);
    // Truncated MSKU is an ambiguous prefix, but the FNSKU disambiguates and
    // takes priority (rule 1 before rule 2).
    expect(reconcileLedgerSku('WIDGET-BLUE-CAN', 'X002GHIJKL', index)).toBe(
      'WIDGET-BLUE-CANONICAL-0002',
    );
  });

  it('does not use FNSKU when it maps to 2+ catalog SKUs (ambiguous)', () => {
    const index = buildCatalogSkuIndex([
      { sku: 'A-0001', fnSku: 'XSHARED' },
      { sku: 'A-0002', fnSku: 'XSHARED' },
    ]);
    expect(reconcileLedgerSku('A-TRUNC', 'XSHARED', index)).toBe('A-TRUNC');
  });
});

describe('reconcileVelocityRows', () => {
  it('applies canonical SKUs and preserves other fields', () => {
    const index = buildCatalogSkuIndex([
      { sku: 'WIDGET-BLUE-LONG-CANONICAL-0001' },
      { sku: 'GADGET-RED-0002' },
    ]);
    const rows = [
      { sku: 'WIDGET-BLUE-LONG-CAN', fn_sku: 'X001', extra: 1 },
      { sku: 'GADGET-RED-0002', fn_sku: 'X002', extra: 2 },
    ];
    expect(reconcileVelocityRows(rows, index)).toEqual([
      { sku: 'WIDGET-BLUE-LONG-CANONICAL-0001', fn_sku: 'X001', extra: 1 },
      { sku: 'GADGET-RED-0002', fn_sku: 'X002', extra: 2 },
    ]);
  });
});
