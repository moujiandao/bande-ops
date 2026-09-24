// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { RouteLoadingVeil } from './nav';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type MountedVeil = {
  appShell: HTMLDivElement;
  mountPoint: HTMLDivElement;
  root: Root;
};

const mounted: MountedVeil[] = [];

function mountVeil(pending: boolean): MountedVeil {
  const appShell = document.createElement('div');
  appShell.id = 'app-shell';

  const activeLink = document.createElement('a');
  activeLink.href = '/catalog';
  activeLink.setAttribute('aria-current', 'page');
  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Primary');
  nav.append(activeLink);
  appShell.append(nav);

  const mountPoint = document.createElement('div');
  document.body.append(appShell, mountPoint);

  const root = createRoot(mountPoint);
  const view = { appShell, mountPoint, root };
  mounted.push(view);

  act(() => root.render(<RouteLoadingVeil pending={pending} />));
  return view;
}

afterEach(() => {
  for (const view of mounted.splice(0)) {
    act(() => view.root.unmount());
    view.appShell.remove();
    view.mountPoint.remove();
  }
});

describe('RouteLoadingVeil lifecycle', () => {
  it('portals the pending dialog, makes the app unavailable, and returns focus after navigation', () => {
    const { appShell, mountPoint, root } = mountVeil(true);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

    expect(dialog).not.toBeNull();
    expect(mountPoint.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(dialog);
    expect(appShell.hasAttribute('inert')).toBe(true);
    expect(appShell.getAttribute('aria-busy')).toBe('true');

    act(() => root.render(<RouteLoadingVeil pending={false} />));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(appShell.hasAttribute('inert')).toBe(false);
    expect(appShell.hasAttribute('aria-busy')).toBe(false);
    expect(document.activeElement).toBe(appShell.querySelector('a[aria-current="page"]'));
  });
});
