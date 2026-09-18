import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/data-source-banner', () => ({
  DataSourceBanner: () => null,
}));

vi.mock('@/components/nav', () => ({
  Nav: () => <nav aria-label="Primary" />,
}));

vi.mock('@/lib/auth/actions', () => ({
  signOut: vi.fn(),
}));

import { AppShell } from './app-shell';

describe('AppShell branding', () => {
  it('uses the accessible Medical Basics logo instead of the placeholder mark', () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ name: 'Owner', role: 'owner' }}>
        <div>Dashboard</div>
      </AppShell>,
    );

    expect(html).toContain('alt="Medical Basics"');
    expect(html).toContain('medical-basics-logo.avif');
    expect(html).not.toContain('Ops App');
  });
});
