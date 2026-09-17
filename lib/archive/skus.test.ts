import { describe, expect, it } from 'vitest';
import { archivedSkuKeys, isSkuArchived } from './skus';

describe('archived SKUs', () => {
  it('matches by marketplace and SKU', () => {
    const keys = archivedSkuKeys([
      {
        marketplace_id: 'US',
        sku: 'SKU-1',
      },
    ]);

    expect(isSkuArchived(keys, 'US', 'SKU-1')).toBe(true);
    expect(isSkuArchived(keys, 'CA', 'SKU-1')).toBe(false);
    expect(isSkuArchived(keys, 'US', 'SKU-2')).toBe(false);
  });
});
