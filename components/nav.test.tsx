import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { navigatePrimaryRoute, RouteLoadingVeil, type RouteNavigationEvent } from './nav';

function clickEvent(overrides: Partial<RouteNavigationEvent> = {}): RouteNavigationEvent {
  return {
    altKey: false,
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    metaKey: false,
    preventDefault: vi.fn(),
    shiftKey: false,
    ...overrides,
  };
}

describe('RouteLoadingVeil', () => {
  it('does not add an overlay when navigation is idle', () => {
    expect(renderToStaticMarkup(<RouteLoadingVeil pending={false} />)).toBe('');
  });

  it('announces and blocks the screen while navigation is pending', () => {
    const html = renderToStaticMarkup(<RouteLoadingVeil pending />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Loading next page…');
    expect(html).toContain('fixed inset-0');
  });
});

describe('navigatePrimaryRoute', () => {
  it('starts a transition to a non-active route', () => {
    const event = clickEvent();
    const push = vi.fn();
    const startTransition = vi.fn((callback: () => void) => callback());

    navigatePrimaryRoute({ event, href: '/catalog', active: false, router: { push }, startTransition });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(startTransition).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith('/catalog');
  });

  it('leaves active and modified clicks to the browser', () => {
    const push = vi.fn();
    const startTransition = vi.fn();

    navigatePrimaryRoute({ event: clickEvent(), href: '/catalog', active: true, router: { push }, startTransition });
    navigatePrimaryRoute({ event: clickEvent({ metaKey: true }), href: '/catalog', active: false, router: { push }, startTransition });

    expect(push).not.toHaveBeenCalled();
    expect(startTransition).not.toHaveBeenCalled();
  });
});
