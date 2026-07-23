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

describe('svd_item_id matching', () => {
  it('matches an SVD item id against the Amazon SKU', () => {
    // The SVD page exposes no FNSKU or Amazon SKU, so those columns are always
    // null; the item id is the only identifier it provides.
    expect(
      resolveSourceMapping({
        amazonSku: 'hp_notebook_2pack',
        fnSku: 'X001518VF5',
        svdRows: [
          { svdItemId: 'hp_notebook_2pack', sku: null, fnSku: null },
        ],
        manualMappings: [],
      }),
    ).toEqual({
      status: 'mapped',
      svdItemId: 'hp_notebook_2pack',
      mappingSource: 'svd_item_id',
    });
  });

  it('lets a manual mapping win over a coincidental item-id match', () => {
    expect(
      resolveSourceMapping({
        amazonSku: 'shared-name',
        fnSku: null,
        svdRows: [
          { svdItemId: 'shared-name', sku: null, fnSku: null },
          { svdItemId: 'the-right-one', sku: null, fnSku: null },
        ],
        manualMappings: [
          { amazonSku: 'shared-name', svdItemId: 'the-right-one' },
        ],
      }),
    ).toMatchObject({ svdItemId: 'the-right-one', mappingSource: 'manual' });
  });

  it('still needs review when no SVD item id matches', () => {
    expect(
      resolveSourceMapping({
        amazonSku: 'nursingbag large',
        fnSku: null,
        svdRows: [{ svdItemId: 'something-else', sku: null, fnSku: null }],
        manualMappings: [],
      }),
    ).toEqual({ status: 'needs-review', reason: 'missing-svd-mapping' });
  });
});
