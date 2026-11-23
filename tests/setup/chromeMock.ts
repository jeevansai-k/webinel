/**
 * In-memory `chrome.*` for tests. Storage areas behave like the real async API
 * (JSON-cloned values, onChanged events). Everything else is a vi.fn().
 */
import { beforeEach, vi } from 'vitest';

type Listener = (...args: any[]) => unknown;

export function createEvent() {
  const listeners = new Set<Listener>();
  return {
    addListener: vi.fn((listener: Listener) => void listeners.add(listener)),
    removeListener: vi.fn((listener: Listener) => void listeners.delete(listener)),
    hasListener: (listener: Listener) => listeners.has(listener),
    listenerCount: () => listeners.size,
    dispatch: (...args: unknown[]) =>
      [...listeners].map((listener) => {
        try {
          return listener(...args);
        } catch {
          return undefined; // like the browser, a failing listener does not break the caller
        }
      }),
    clear: () => listeners.clear(),
  };
}

const storageChanged = createEvent();

class MemoryArea {
  readonly data = new Map<string, unknown>();
  constructor(private readonly areaName: string) {}

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    const list = keys == null ? [...this.data.keys()] : Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of list) {
      if (this.data.has(key)) result[key] = structuredClone(this.data.get(key));
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: this.data.get(key), newValue: structuredClone(value) };
      this.data.set(key, structuredClone(value));
    }
    storageChanged.dispatch(changes, this.areaName);
  }

  async remove(keys: string | string[]): Promise<void> {
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      changes[key] = { oldValue: this.data.get(key) };
      this.data.delete(key);
    }
    storageChanged.dispatch(changes, this.areaName);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

export const localArea = new MemoryArea('local');
export const sessionArea = new MemoryArea('session');

/** Test hook: how the fake background answers runtime.sendMessage. */
export let messageHandler: (message: any) => unknown = () => undefined;
export function onSendMessage(handler: (message: any) => unknown): void {
  messageHandler = handler;
}

/** Convenience: answer typed envelopes by message type. */
export function respondTo(responses: Record<string, (payload: any) => unknown>): void {
  onSendMessage(async (message) => {
    const responder = responses[message.type];
    if (!responder) return { ok: false, error: `No mock for ${message.type}` };
    try {
      return { ok: true, data: await responder(message.payload) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });
}

const EXTENSION_ID = 'webinel-test';

function buildChrome() {
  return {
    storage: { local: localArea, session: sessionArea, onChanged: storageChanged },
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path.replace(/^\//, '')}`,
      getManifest: () => ({ version: '1.0.0', manifest_version: 3 }),
      getPlatformInfo: vi.fn(async () => ({ os: 'linux', arch: 'x86-64', nacl_arch: 'x86-64' })),
      sendMessage: vi.fn(async (message: unknown) => messageHandler(message)),
      onMessage: createEvent(),
    },
    tabs: {
      query: vi.fn(async () => [] as chrome.tabs.Tab[]),
      get: vi.fn(async (tabId: number) => ({ id: tabId, url: '' }) as chrome.tabs.Tab),
      getCurrent: vi.fn(async () => undefined),
      update: vi.fn(async () => ({}) as chrome.tabs.Tab),
      create: vi.fn(async () => ({}) as chrome.tabs.Tab),
      remove: vi.fn(async () => undefined),
      onRemoved: createEvent(),
      onUpdated: createEvent(),
    },
    windows: {
      create: vi.fn(async () => ({ id: 99 }) as chrome.windows.Window),
      update: vi.fn(async () => ({}) as chrome.windows.Window),
      getCurrent: vi.fn(async () => ({ id: 99 }) as chrome.windows.Window),
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
    notifications: { create: vi.fn(async () => 'id') },
    downloads: {
      cancel: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      search: vi.fn(async () => [] as chrome.downloads.DownloadItem[]),
      onCreated: createEvent(),
      onChanged: createEvent(),
    },
    permissions: { request: vi.fn(async () => true) },
    scripting: { executeScript: vi.fn(async () => [] as unknown[]) },
    webNavigation: { onBeforeNavigate: createEvent(), onCommitted: createEvent(), onTabReplaced: createEvent() },
    webRequest: { onBeforeRedirect: createEvent(), onCompleted: createEvent(), onErrorOccurred: createEvent() },
  };
}

export type ChromeMock = ReturnType<typeof buildChrome>;

const chromeMock = buildChrome();
(globalThis as unknown as { chrome: ChromeMock }).chrome = chromeMock;

export function chromeFake(): ChromeMock {
  return chromeMock;
}

beforeEach(async () => {
  storageChanged.clear();
  await localArea.clear();
  await sessionArea.clear();
  onSendMessage(() => undefined);
  const fresh = buildChrome();
  // Reset mocks in place so modules holding references keep working.
  Object.assign(chromeMock.runtime, { sendMessage: fresh.runtime.sendMessage, getPlatformInfo: fresh.runtime.getPlatformInfo });
  Object.assign(chromeMock.windows, fresh.windows);
  Object.assign(chromeMock.tabs, { ...fresh.tabs, onRemoved: chromeMock.tabs.onRemoved, onUpdated: chromeMock.tabs.onUpdated });
  Object.assign(chromeMock.action, fresh.action);
  Object.assign(chromeMock.notifications, fresh.notifications);
  Object.assign(chromeMock.downloads, { ...fresh.downloads, onCreated: chromeMock.downloads.onCreated, onChanged: chromeMock.downloads.onChanged });
  Object.assign(chromeMock.permissions, fresh.permissions);
  Object.assign(chromeMock.scripting, fresh.scripting);
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
});
