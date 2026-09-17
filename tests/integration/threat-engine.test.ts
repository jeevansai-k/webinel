import { describe, expect, it, vi } from 'vitest';
import { ThreatEngine } from '../../src/services/ThreatEngine';
import { settingsStore } from '../../src/storage/SettingsStore';
import { statsStore } from '../../src/storage/StatsStore';
import { whitelistStore } from '../../src/storage/WhitelistStore';
import { createService, fakeClient, vtSummary } from './helpers';

function engineWith(client = fakeClient(), key: string | null = 'c'.repeat(64)) {
  const { service } = createService(client, key);
  return { engine: new ThreatEngine(service), client };
}

describe('ThreatEngine pipeline', () => {
  it('returns Safe only with VirusTotal confirmation', async () => {
    const { engine } = engineWith();
    const report = await engine.evaluate('https://example.com/page', 'domain');
    expect(report).toMatchObject({ verdict: 'safe', action: 'allow', source: 'virustotal', target: 'example.com' });
    expect((await statsStore.get()).verdicts.safe).toBe(1);
  });

  it('returns Unknown — not Safe — without an API key', async () => {
    const { engine, client } = engineWith(fakeClient(), null);
    const report = await engine.evaluate('https://example.com/', 'domain');
    expect(report.verdict).toBe('unknown');
    expect(report.action).toBe('allow');
    expect(client.getDomainReport).not.toHaveBeenCalled();
  });

  it('blocks dangerous sites and warns on suspicious ones', async () => {
    expect((await engineWith(fakeClient({ summary: vtSummary(4) })).engine.evaluate('https://bad.test/', 'domain')).action).toBe('block');
    expect((await engineWith(fakeClient({ summary: vtSummary(1) })).engine.evaluate('https://meh.test/', 'domain')).action).toBe('warn');
    await settingsStore.patch({ blockSuspicious: true });
    expect((await engineWith(fakeClient({ summary: vtSummary(1) })).engine.evaluate('https://meh2.test/', 'domain')).action).toBe('block');
  });

  it('blocks obvious phishing from heuristics alone when VirusTotal is unavailable', async () => {
    const { engine } = engineWith(fakeClient(), null);
    const report = await engine.evaluate('http://paypal.com.secure-login.verify-account.xyz/signin', 'domain');
    expect(report.verdict).toBe('dangerous');
    expect(report.action).toBe('block');
  });

  it('short-circuits whitelisted hosts', async () => {
    await whitelistStore.add('bad.test');
    const { engine, client } = engineWith(fakeClient({ summary: vtSummary(9) }));
    const report = await engine.evaluate('https://www.bad.test/', 'domain');
    expect(report).toMatchObject({ verdict: 'safe', action: 'allow', source: 'whitelist' });
    expect(client.getDomainReport).not.toHaveBeenCalled();
  });

  it('rejects non-web URLs', async () => {
    await expect(engineWith().engine.evaluate('file:///etc/passwd', 'url')).rejects.toThrow();
  });

  it('scans links by domain, unwrapping mail redirectors, worst first', async () => {
    const client = fakeClient();
    client.getDomainReport.mockImplementation(async (host: string) => ({
      status: 'ok' as const,
      summary: vtSummary(host === 'evil.test' ? 5 : 0),
      latencyMs: 1,
    }));
    const { engine } = engineWith(client);
    const summary = await engine.scanLinks([
      'https://good.test/a',
      'https://good.test/b',
      'https://www.google.com/url?q=https://evil.test/login',
      'mailto:someone@example.com',
    ]);
    expect(summary.total).toBe(3);
    expect(summary.items[0]).toMatchObject({ host: 'evil.test', verdict: 'dangerous' });
    expect(summary.counts).toMatchObject({ dangerous: 1, safe: 2 });
    expect(client.getDomainReport).toHaveBeenCalledTimes(2); // good.test is cached after the first link
  });

  it('keeps a stale dangerous verdict while offline but never trusts a stale safe one', async () => {
    const client = fakeClient({ summary: vtSummary(6) });
    const { engine } = engineWith(client);
    await engine.evaluate('https://bad.test/', 'domain');
    client.getDomainReport.mockResolvedValue({ status: 'unreachable', summary: null, latencyMs: null });
    expect((await engine.evaluate('https://bad.test/', 'domain')).verdict).toBe('dangerous');

    const safeClient = fakeClient();
    const safe = engineWith(safeClient);
    await safe.engine.evaluate('https://fine.test/', 'domain');
    safeClient.getDomainReport.mockResolvedValue({ status: 'unreachable', summary: null, latencyMs: null });
    // A fresh cache entry is still used within 24 h…
    expect((await safe.engine.evaluate('https://fine.test/', 'domain')).verdict).toBe('safe');
    // …but once it has expired, an offline fallback cannot vouch for safety.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 25 * 3_600_000 });
    try {
      const stale = await safe.engine.evaluate('https://fine.test/', 'domain');
      expect(stale.verdict).toBe('error');
      expect(stale.virusTotalStatus).toBe('unreachable');
    } finally {
      vi.useRealTimers();
    }
  });
});
