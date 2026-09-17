import { describe, expect, it } from 'vitest';
import { normalizeWhitelistEntry, whitelistStore } from './WhitelistStore';

describe('WhitelistStore', () => {
  it('normalizes user input to a bare host', () => {
    expect(normalizeWhitelistEntry('https://Example.com/path?q=1')).toBe('example.com');
    expect(normalizeWhitelistEntry('*.corp.example.org')).toBe('corp.example.org');
    expect(normalizeWhitelistEntry('localhost')).toBe('localhost');
    expect(normalizeWhitelistEntry('   ')).toBeNull();
    expect(normalizeWhitelistEntry('not a domain')).toBeNull();
    expect(normalizeWhitelistEntry('intranet')).toBeNull();
  });

  it('adds, deduplicates, sorts and removes entries', async () => {
    await whitelistStore.add('zeta.test');
    await whitelistStore.add('https://alpha.test/');
    await whitelistStore.add('ALPHA.test');
    expect(await whitelistStore.get()).toEqual(['alpha.test', 'zeta.test']);
    await whitelistStore.remove('alpha.test');
    expect(await whitelistStore.get()).toEqual(['zeta.test']);
  });

  it('covers subdomains but not look-alikes', async () => {
    await whitelistStore.add('example.com');
    expect(await whitelistStore.contains('example.com')).toBe(true);
    expect(await whitelistStore.contains('mail.example.com')).toBe(true);
    expect(await whitelistStore.contains('example.com.evil.net')).toBe(false);
    expect(await whitelistStore.contains('myexample.com')).toBe(false);
  });

  it('rejects invalid entries', async () => {
    await expect(whitelistStore.add('???')).rejects.toThrow(/valid domain/);
  });

  it('serializes concurrent updates without losing data', async () => {
    await Promise.all(['a.test', 'b.test', 'c.test', 'd.test'].map((host) => whitelistStore.add(host)));
    expect(await whitelistStore.get()).toHaveLength(4);
  });
});
