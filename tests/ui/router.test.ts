import { describe, expect, it, vi } from 'vitest';
import { Router, type ScreenMount, type ScreenName } from '../../src/popup/router';

function screens(overrides: Partial<Record<ScreenName, ScreenMount>>): Record<ScreenName, ScreenMount> {
  const blank: ScreenMount = (root) => {
    root.textContent = root.dataset.screen ?? '';
  };
  const names: ScreenName[] = ['home', 'scan', 'settings', 'statistics', 'bookmarks', 'whitelist', 'timeline', 'advanced', 'documents', 'privacy', 'terms'];
  return Object.fromEntries(names.map((name) => [name, overrides[name] ?? blank])) as Record<ScreenName, ScreenMount>;
}

describe('popup router', () => {
  it('shows a recoverable error instead of a blank popup when a screen fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const outlet = document.createElement('main');
    let attempts = 0;
    const router = new Router(
      outlet,
      screens({
        settings: (root) => {
          attempts += 1;
          if (attempts === 1) throw new Error('background asleep');
          root.textContent = 'settings ready';
        },
      }),
    );
    await router.show('settings', false);
    expect(outlet.querySelector('[role="alert"]')?.textContent).toContain('could not load');

    outlet.querySelector<HTMLButtonElement>('[data-action="retry"]')!.click();
    await vi.waitFor(() => expect(outlet.textContent).toContain('settings ready'));
  });

  it('offers a way back home from a failed screen', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const outlet = document.createElement('main');
    const router = new Router(outlet, screens({ timeline: () => Promise.reject(new Error('boom')) }));
    await router.show('timeline', false);
    outlet.querySelector<HTMLButtonElement>('[data-action="home"]')!.click();
    await vi.waitFor(() => expect(router.active).toBe('home'));
  });
});
