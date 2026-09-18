import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useActionState: mocks.state,
}));
vi.mock('./actions', () => ({ syncCatalogAction: vi.fn() }));
import { CatalogSyncControl } from './sync-control';

describe('catalog sync feedback', () => {
  it('shows partial success and failure together so stale catalog data is explicit', () => {
    mocks.state.mockReturnValue([
      { message: 'FBA inventory refreshed (191 SKUs).', error: 'Catalog could not refresh.' },
      '/sync', false,
    ]);
    const html = renderToStaticMarkup(<CatalogSyncControl />);
    expect(html).toContain('role="status"');
    expect(html).toContain('FBA inventory refreshed (191 SKUs).');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Catalog could not refresh.');
    expect(html).not.toContain('disabled=""');
  });

  it('disables repeat submission and replaces previous results while pending', () => {
    mocks.state.mockReturnValue([
      { message: 'Previous success', error: 'Previous error' }, '/sync', true,
    ]);
    const html = renderToStaticMarkup(<CatalogSyncControl />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('Syncing…');
    expect(html).toContain('Refreshing FBA inventory and catalog from Amazon…');
    expect(html).not.toContain('Previous');
  });
});
