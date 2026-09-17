import { describe, expect, it } from 'vitest';
import { LocalStore } from '../storage/LocalStore';
import { RateLimiter } from './RateLimiter';

function createLimiter() {
  let now = 0;
  const store = new LocalStore('vt.rate', () => ({ timestamps: [] as number[], cooldownUntil: 0 }), chrome.storage.session);
  return { limiter: new RateLimiter(store, 4, 60_000, () => now), advance: (ms: number) => (now += ms) };
}

describe('RateLimiter', () => {
  it('allows 4 requests per minute', async () => {
    const { limiter, advance } = createLimiter();
    for (let i = 0; i < 4; i++) expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(false);
    advance(60_000);
    expect(await limiter.tryAcquire()).toBe(true);
  });

  it('honours cooldowns after quota errors', async () => {
    const { limiter, advance } = createLimiter();
    await limiter.coolDown(30_000);
    expect(await limiter.tryAcquire()).toBe(false);
    advance(30_000);
    expect(await limiter.tryAcquire()).toBe(true);
  });

  it('counts recorded requests toward the window', async () => {
    const { limiter } = createLimiter();
    for (let i = 0; i < 4; i++) await limiter.record();
    expect(await limiter.tryAcquire()).toBe(false);
  });
});
