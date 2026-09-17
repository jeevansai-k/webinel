import { describe, expect, it } from 'vitest';
import { localArea } from '../../tests/setup/chromeMock';
import { sampleCore } from '../../tests/integration/helpers';
import { CACHE_RULES } from '../shared/config';
import type { VirusTotalSummary } from '../shared/verdict';
import { SmartCache, ttlFor } from './SmartCache';

const summary = (malicious: number): VirusTotalSummary => ({
  stats: { malicious, suspicious: 0, harmless: 50, undetected: 5 },
  reputation: 0,
  flaggedBy: [],
  lastAnalysisDate: null,
  permalink: '',
});

function createCache(maxEntries = 100) {
  let now = 1_000_000;
  const cache = new SmartCache(chrome.storage.local, () => now, maxEntries);
  return { cache, advance: (ms: number) => (now += ms) };
}

describe('SmartCache', () => {
  it('returns fresh verified results with ratio, analysis id, timestamp and verdict', async () => {
    const { cache } = createCache();
    await cache.set('url', 'https://a.test/', { status: 'ok', summary: summary(0), core: sampleCore(0), analysisId: 'an-9' });
    const hit = await cache.get('url', 'https://a.test/');
    expect(hit?.fresh).toBe(true);
    expect(hit?.entry).toMatchObject({
      verdict: 'safe',
      analysisId: 'an-9',
      ratio: { detected: 0, total: 68 },
      storedAt: 1_000_000,
      targetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await cache.get('file', 'https://a.test/')).toBeNull();
  });

  it('keeps URLs fresh for 24 hours and files for 7 days', async () => {
    expect(ttlFor('url', 'safe')).toBe(24 * 3_600_000);
    expect(ttlFor('domain', 'suspicious')).toBe(24 * 3_600_000);
    expect(ttlFor('file', 'safe')).toBe(7 * 86_400_000);
    const { cache, advance } = createCache();
    await cache.set('url', 'https://a.test/', { status: 'ok', summary: summary(0) });
    await cache.set('file', 'f'.repeat(64), { status: 'ok', summary: summary(0) });
    advance(CACHE_RULES.urlTtlMs + 1);
    expect((await cache.get('url', 'https://a.test/'))?.fresh).toBe(false);
    expect((await cache.get('file', 'f'.repeat(64)))?.fresh).toBe(true);
    advance(CACHE_RULES.fileTtlMs);
    expect((await cache.get('file', 'f'.repeat(64)))?.fresh).toBe(false);
  });

  it('never treats dangerous results as fresh', async () => {
    const { cache } = createCache();
    await cache.set('domain', 'bad.test', { status: 'ok', summary: summary(9) });
    const hit = await cache.get('domain', 'bad.test');
    expect(hit?.entry.verdict).toBe('dangerous');
    expect(hit?.fresh).toBe(false);
  });

  it('keeps unknown results only briefly', async () => {
    const { cache, advance } = createCache();
    await cache.set('url', 'https://new.test/', { status: 'not-found', summary: null });
    expect((await cache.get('url', 'https://new.test/'))?.fresh).toBe(true);
    advance(CACHE_RULES.unknownTtlMs + 1);
    expect((await cache.get('url', 'https://new.test/'))?.fresh).toBe(false);
  });

  it('drops entries entirely after the offline-fallback window', async () => {
    const { cache, advance } = createCache();
    await cache.set('url', 'https://a.test/', { status: 'ok', summary: summary(0) });
    advance(CACHE_RULES.urlTtlMs + CACHE_RULES.offlineFallbackMs);
    expect(await cache.get('url', 'https://a.test/')).toBeNull();
  });

  it('does not cache failures', async () => {
    const { cache } = createCache();
    for (const status of ['no-key', 'rate-limited', 'unreachable', 'quota-exceeded', 'invalid-key', 'forbidden', 'error'] as const) {
      expect(await cache.set('domain', 'x.test', { status, summary: null })).toBe(false);
    }
    expect(await cache.size()).toBe(0);
  });

  it('stores hashed keys only — no readable URLs in keys', async () => {
    const { cache } = createCache();
    await cache.set('domain', 'private.example', { status: 'ok', summary: summary(0) });
    const keys = [...localArea.data.keys()];
    expect(keys.some((key) => key.includes('private.example'))).toBe(false);
    expect(keys).toContain(await cache.keyFor('domain', 'private.example'));
    expect(await cache.keyFor('domain', 'private.example')).toMatch(/^cache:domain:[a-f0-9]{64}$/);
  });

  it('evicts the oldest entries beyond the limit', async () => {
    const { cache, advance } = createCache(2);
    for (const host of ['a.test', 'b.test', 'c.test']) {
      await cache.set('domain', host, { status: 'ok', summary: summary(0) });
      advance(10);
    }
    expect(await cache.size()).toBe(2);
    expect(await cache.get('domain', 'a.test')).toBeNull();
    expect(await cache.get('domain', 'c.test')).not.toBeNull();
  });

  it('invalidates and clears', async () => {
    const { cache } = createCache();
    await cache.set('domain', 'a.test', { status: 'ok', summary: summary(0) });
    await cache.set('domain', 'b.test', { status: 'ok', summary: summary(0) });
    await cache.invalidate('domain', 'a.test');
    expect(await cache.get('domain', 'a.test')).toBeNull();
    expect(await cache.clear()).toBe(1);
    expect(await cache.get('domain', 'b.test')).toBeNull();
  });

  it('looks entries up in well under 50 ms with a full cache', async () => {
    const { cache } = createCache(CACHE_RULES.maxEntries);
    const core = sampleCore(1);
    await Promise.all(
      Array.from({ length: CACHE_RULES.maxEntries }, (_, i) => cache.set('url', `https://site${i}.test/`, { status: 'ok', summary: summary(1), core })),
    );
    const started = performance.now();
    const hit = await cache.get('url', 'https://site250.test/');
    expect(performance.now() - started).toBeLessThan(50);
    expect(hit?.entry.ratio).toEqual(core.ratio);
  });
});
