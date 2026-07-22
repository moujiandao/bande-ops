import { describe, expect, it } from 'vitest';
import { resolveSourceMapping } from './mappings';

describe('resolveSourceMapping', () => {
  it('prefers FNSKU over SKU and manual mapping', () => {
    expect(
      resolveSourceMapping({
        amazonSku: 'SKU-1',
        fnSku: 'FNSKU-1',
        svdRows: [
          { svdItemId: 'svd-sku', sku: 'SKU-1', fnSku: null },
          { svdItemId: 'svd-fnsku', sku: 'OTHER', fnSku: 'FNSKU-1' },
        ],
        manualMappings: [{ amazonSku: 'SKU-1', svdItemId: 'svd-manual' }],
      }),
    ).toEqual({
      status: 'mapped',
      svdItemId: 'svd-fnsku',
      mappingSource: 'fn_sku',
    });
  });
});
