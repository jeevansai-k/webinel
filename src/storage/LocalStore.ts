/**
 * Typed wrapper around one key in chrome.storage.local.
 * Updates within one context are serialized so concurrent read-modify-write
 * cycles (common in the background) cannot lose data.
 * Webinel never uses chrome.storage.sync.
 */
export class LocalStore<T> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly key: string,
    private readonly createDefault: () => T,
    private readonly area: chrome.storage.StorageArea = chrome.storage.local,
  ) {}

  async get(): Promise<T> {
    const result = await this.area.get(this.key);
    const stored = result[this.key] as T | undefined;
    return stored === undefined ? this.createDefault() : stored;
  }

  async set(value: T): Promise<void> {
    await this.area.set({ [this.key]: value });
  }

  /** Serialized read-modify-write. Returns the new value. */
  update(mutate: (current: T) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const next = mutate(await this.get());
      await this.set(next);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async clear(): Promise<void> {
    await this.area.remove(this.key);
  }

  /** Calls `listener` whenever another context changes this key. Returns an unsubscribe function. */
  subscribe(listener: (value: T) => void): () => void {
    const ownArea = this.area === chrome.storage.session ? 'session' : 'local';
    const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== ownArea || !(this.key in changes)) return;
      const next = changes[this.key]?.newValue as T | undefined;
      listener(next === undefined ? this.createDefault() : next);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
}
