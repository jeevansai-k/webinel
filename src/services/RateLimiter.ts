/**
 * Sliding-window limiter for VirusTotal requests.
 * State lives in chrome.storage.session so it survives service-worker restarts
 * but not browser restarts.
 */
import { VIRUSTOTAL } from '../shared/config';
import { LocalStore } from '../storage/LocalStore';

interface RateState {
  timestamps: number[];
  cooldownUntil: number;
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export class RateLimiter {
  constructor(
    private readonly store = new LocalStore<RateState>(
      'vt.rate',
      () => ({ timestamps: [], cooldownUntil: 0 }),
      chrome.storage.session,
    ),
    private readonly limit: number = VIRUSTOTAL.requestsPerWindow,
    private readonly windowMs: number = VIRUSTOTAL.windowMs,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Reserves a slot if one is free. */
  async tryAcquire(): Promise<boolean> {
    let granted = false;
    await this.store.update((state) => {
      const now = this.now();
      const recent = state.timestamps.filter((time) => now - time < this.windowMs);
      granted = now >= state.cooldownUntil && recent.length < this.limit;
      return { ...state, timestamps: granted ? [...recent, now] : recent };
    });
    return granted;
  }

  /** Milliseconds until a slot is likely free (0 when one is free now). */
  async waitTime(): Promise<number> {
    const state = await this.store.get();
    const now = this.now();
    const recent = state.timestamps.filter((time) => now - time < this.windowMs).sort((a, b) => a - b);
    const cooldown = Math.max(0, state.cooldownUntil - now);
    const windowWait = recent.length < this.limit ? 0 : recent[recent.length - this.limit]! + this.windowMs - now;
    return Math.max(cooldown, windowWait);
  }

  /**
   * Waits for a slot (used by Advanced Analysis polling, which has no deadline).
   * Gives up with `false` when `deadline` passes or `signal` aborts.
   */
  async acquire(options: { signal?: AbortSignal; deadline?: number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {}): Promise<boolean> {
    const sleep = options.sleep ?? defaultSleep;
    for (;;) {
      if (options.signal?.aborted) return false;
      if (await this.tryAcquire()) return true;
      const wait = Math.max(250, await this.waitTime());
      if (options.deadline !== undefined && this.now() + wait > options.deadline) return false;
      await sleep(wait, options.signal);
    }
  }

  /** Records a request made outside tryAcquire (e.g. the user's health check). */
  async record(): Promise<void> {
    await this.store.update((state) => ({ ...state, timestamps: [...state.timestamps, this.now()] }));
  }

  /** Pauses all requests, e.g. after VirusTotal answers 429. */
  async coolDown(durationMs: number = this.windowMs): Promise<void> {
    await this.store.update((state) => ({ ...state, cooldownUntil: this.now() + durationMs }));
  }
}
