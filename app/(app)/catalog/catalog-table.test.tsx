import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    width,
    height,
    sizes,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
    sizes: string;
  }) => (
    <span
      role="img"
      aria-label={alt}
      data-src={src}
      data-width={width}
      data-height={height}
      data-sizes={sizes}
    />
  ),
}));

vi.mock('@/lib/notes/notes-actions', () => ({
  upsertSkuNote: vi.fn(),
}));

import { CatalogTable } from './catalog-table';

describe('CatalogTable thumbnails', () => {
  it('requests an optimized thumbnail within the 300px display budget', () => {
    const html = renderToStaticMarkup(
      <CatalogTable
        rows={[
          {
            marketplace_id: 'ATVPDKIKX0DER',
            sku: 'SKU-1',
            asin: 'ASIN-1',
            title: 'Product one',
            image_url: 'https://m.media-amazon.com/images/main.jpg',
            fba_on_hand: 4,
            fba_available: 3,
            fba_fc_transfer: 1,
            note: '',
          },
        ]}
      />,
    );

    expect(html).toContain('aria-label="Product one"');
    expect(html).toContain('data-width="300"');
    expect(html).toContain('data-height="300"');
    expect(html).toContain('data-sizes="40px"');
  });
});
