import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/shared/config';
import { activityStore, toActivityStatus } from '../../src/storage/ActivityStore';
import { bookmarkStore } from '../../src/storage/BookmarkStore';
import { isPlausibleApiKey, SecretStore, type CryptoKeyProvider } from '../../src/storage/SecretStore';
import { DEFAULT_SETTINGS, settingsStore } from '../../src/storage/SettingsStore';
import { lastDays, statsStore } from '../../src/storage/StatsStore';
import { timelineStore } from '../../src/storage/TimelineStore';
import { localArea } from '../setup/chromeMock';

function memoryKeyProvider(): CryptoKeyProvider {
  const key = crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { getKey: () => key };
}

const API_KEY = '0123456789abcdef'.repeat(4);

describe('SecretStore', () => {
  it('encrypts the key at rest in local storage only', async () => {
    const secrets = new SecretStore(memoryKeyProvider());
    await secrets.saveApiKey(`  ${API_KEY}  `);
    const stored = JSON.stringify([...localArea.data.entries()]);
    expect(stored).not.toContain(API_KEY);
    expect(await secrets.hasApiKey()).toBe(true);
    expect(await secrets.readApiKey()).toBe(API_KEY);
    expect(chrome.storage).not.toHaveProperty('sync');
  });

  it('rejects malformed keys', async () => {
    expect(isPlausibleApiKey('short')).toBe(false);
    await expect(new SecretStore(memoryKeyProvider()).saveApiKey('not-a-key')).rejects.toThrow(/64 hexadecimal/);
  });

  it('discards ciphertext it can no longer decrypt', async () => {
    await new SecretStore(memoryKeyProvider()).saveApiKey(API_KEY);
    const otherDevice = new SecretStore(memoryKeyProvider());
    expect(await otherDevice.readApiKey()).toBeNull();
    expect(await otherDevice.hasApiKey()).toBe(false);
  });

  it('clears the key', async () => {
    const secrets = new SecretStore(memoryKeyProvider());
    await secrets.saveApiKey(API_KEY);
    await secrets.clearApiKey();
    expect(await secrets.readApiKey()).toBeNull();
  });
});

describe('local stores', () => {
  it('fills in defaults for settings', async () => {
    expect(await settingsStore.get()).toEqual(DEFAULT_SETTINGS);
    await localArea.set({ settings: { theme: 'light' } });
    expect(await settingsStore.get()).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' });
  });

  it('records statistics per day', async () => {
    const now = new Date('2026-09-17T12:00:00').getTime();
    await statsStore.recordVerdict('safe', now);
    await statsStore.recordVerdict('dangerous', now);
    await statsStore.increment('blocked');
    const stats = await statsStore.get();
    expect(stats.scanned).toBe(2);
    expect(stats.verdicts.dangerous).toBe(1);
    expect(stats.counters.blocked).toBe(1);
    const week = lastDays(stats, 7, now);
    expect(week).toHaveLength(7);
    expect(week[6]).toEqual({ day: '2026-09-17', scanned: 2, threats: 1 });
  });

  it('caps the timeline and keeps newest first', async () => {
    for (let i = 0; i < LIMITS.timelineEntries + 5; i++) {
      await timelineStore.record({ kind: 'manual-scan', subject: `site${i}.test`, verdict: 'safe', detail: '' });
    }
    const events = await timelineStore.get();
    expect(events).toHaveLength(LIMITS.timelineEntries);
    expect(events[0]?.subject).toBe(`site${LIMITS.timelineEntries + 4}.test`);
  });

  it('keeps one activity row per host and never maps unknown to safe', async () => {
    await activityStore.record({ host: 'a.test', status: 'safe', timestamp: 1 });
    await activityStore.record({ host: 'b.test', status: 'warning', timestamp: 2 });
    await activityStore.record({ host: 'a.test', status: 'blocked', timestamp: 3 });
    expect((await activityStore.get()).map((entry) => `${entry.host}:${entry.status}`)).toEqual(['a.test:blocked', 'b.test:warning']);
    expect(toActivityStatus('unknown', 'allow')).toBe('unknown');
    expect(toActivityStatus('error', 'allow')).toBe('unknown');
    expect(toActivityStatus('dangerous', 'block')).toBe('blocked');
    expect(toActivityStatus('suspicious', 'warn')).toBe('warning');
  });

  it('stores secure bookmarks for web pages only', async () => {
    await bookmarkStore.add('https://Bank.example/login#top', '  My bank  ');
    await bookmarkStore.add('https://bank.example/login', 'duplicate');
    await expect(bookmarkStore.add('javascript:alert(1)', 'x')).rejects.toThrow();
    const [bookmark] = await bookmarkStore.get();
    expect(await bookmarkStore.get()).toHaveLength(1);
    expect(bookmark).toMatchObject({ url: 'https://bank.example/login', host: 'bank.example', title: 'My bank', lastVerdict: null });
    await bookmarkStore.markChecked(bookmark!.id, 'safe');
    expect((await bookmarkStore.get())[0]?.lastVerdict).toBe('safe');
  });

  it('never stores raw clipboard text or email bodies', async () => {
    await timelineStore.record({ kind: 'links-scanned', subject: '3 links', verdict: null, detail: '0 dangerous' });
    const everything = JSON.stringify([...localArea.data.entries()]);
    expect(everything).not.toMatch(/clipboard|body/i);
  });
});
