/**
 * Loads the real service-worker entry and drives it through browser events,
 * the way Chrome does.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { chromeFake } from '../setup/chromeMock';

const PHISHING_URL = 'http://paypal.com.secure-login.verify-account.invalid/signin';

function fire(event: { dispatch: (...args: unknown[]) => unknown }, ...args: unknown[]) {
  event.dispatch(...args);
}

beforeAll(async () => {
  vi.resetModules();
  await import('../../src/background/index');
});

describe('background service worker', () => {
  it('registers every navigation trigger', () => {
    const chrome = chromeFake();
    expect(chrome.webNavigation.onBeforeNavigate.listenerCount()).toBe(1);
    expect(chrome.webNavigation.onCommitted.listenerCount()).toBe(1);
    expect(chrome.webNavigation.onTabReplaced.listenerCount()).toBe(1);
    expect(chrome.tabs.onUpdated.listenerCount()).toBe(1);
    expect(chrome.runtime.onMessage.listenerCount()).toBe(1);
  });

  it('shows the warning page for a phishing URL typed into a new tab', async () => {
    const chrome = chromeFake();
    // Chrome has not updated the tab yet — it still reports the new-tab page.
    chrome.tabs.get.mockResolvedValue({ id: 42, url: 'chrome://newtab/' } as chrome.tabs.Tab);
    fire(chrome.webNavigation.onBeforeNavigate, { tabId: 42, frameId: 0, url: PHISHING_URL });
    fire(chrome.webNavigation.onCommitted, { tabId: 42, frameId: 0, url: PHISHING_URL });
    fire(chrome.tabs.onUpdated, 42, { url: PHISHING_URL });

    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalledTimes(1));
    const [tabId, { url }] = chrome.tabs.update.mock.calls[0] as unknown as [number, { url: string }];
    expect(tabId).toBe(42);
    expect(url).toMatch(/^chrome-extension:\/\/webinel-test\/warning\/Warning\.html\?id=[\w-]+$/);

    // The warning page can load its details through the real message router.
    const id = new URL(url).searchParams.get('id');
    const respond = vi.fn();
    chrome.runtime.onMessage.dispatch({ channel: 'webinel', type: 'warning:details', payload: { id } }, { id: 'webinel-test', url }, respond);
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({
        ok: true,
        data: expect.objectContaining({ host: 'paypal.com.secure-login.verify-account.invalid', verdict: 'dangerous', url: PHISHING_URL }),
      }),
    );
  });

  it('ignores sub-frames and leaves safe-looking pages alone', async () => {
    const chrome = chromeFake();
    fire(chrome.webNavigation.onBeforeNavigate, { tabId: 7, frameId: 3, url: PHISHING_URL });
    fire(chrome.webNavigation.onBeforeNavigate, { tabId: 8, frameId: 0, url: 'https://www.wikipedia.org/' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});
