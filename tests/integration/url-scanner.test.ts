import { describe, expect, it } from 'vitest';
import { UrlScanner } from '../../src/services/UrlScanner';
import { SCANNING } from '../../src/shared/config';
import type { ScanOutcome, ScanReport } from '../../src/shared/scan';
import { createService, fakeClient, sampleCore, snapshot, TEST_KEY, VirtualClock } from './helpers';

function setup(client = fakeClient(), key: string | null = TEST_KEY) {
  const clock = new VirtualClock();
  const { service } = createService(client, key, clock);
  return { scanner: new UrlScanner(service, clock), client, clock, service };
}

function report(outcome: ScanOutcome): ScanReport {
  if (outcome.kind !== 'report') throw new Error(`expected report, got ${JSON.stringify(outcome)}`);
  return outcome.report;
}

const notFound = () => fakeClient({ status: 'not-found', summary: null, core: null });

describe('UrlScanner.quickScan (Scan Now)', () => {
  it('returns a known URL immediately without submitting it', async () => {
    const client = fakeClient({ core: sampleCore(4, 'url', 'https://evil.test/') });
    const { scanner, clock } = setup(client);
    const result = report(await scanner.quickScan('evil.test'));
    expect(result).toMatchObject({ kind: 'url', verdict: 'dangerous', state: 'complete', source: 'virustotal' });
    expect(client.getUrlReport).toHaveBeenCalledWith('https://evil.test/', TEST_KEY, expect.anything());
    expect(client.submitUrl).not.toHaveBeenCalled();
    expect(clock.sleeps).toEqual([]);
  });

  it('serves repeat scans from the Smart Cache', async () => {
    const { scanner, client } = setup();
    await scanner.quickScan('https://example.com/');
    const second = report(await scanner.quickScan('https://example.com/'));
    expect(second.source).toBe('cache');
    expect(client.getUrlReport).toHaveBeenCalledTimes(1);
  });

  it('uses cached domain intel for IP addresses without extra requests', async () => {
    const client = fakeClient();
    client.getDomainReport.mockResolvedValue({
      status: 'ok',
      summary: { stats: { malicious: 0, suspicious: 0, harmless: 5, undetected: 0 }, reputation: 0, flaggedBy: [], lastAnalysisDate: null, permalink: '' },
      latencyMs: 1,
      intel: { domain: 'example.com', ipAddresses: ['192.0.2.7'], dns: [], certificate: null, whois: [], categories: [], reputation: 0 },
    });
    const { scanner, service } = setup(client);
    await service.lookup('domain', 'example.com');
    const result = report(await scanner.quickScan('https://example.com/'));
    expect(result.url?.ipAddresses).toEqual(['192.0.2.7']);
    expect(client.getDomainReport).toHaveBeenCalledTimes(1);
  });

  it('submits unknown URLs and returns whatever finished within 6 seconds', async () => {
    const client = notFound();
    client.getAnalysis
      .mockResolvedValueOnce({ status: 'ok', analysis: snapshot('queued') })
      .mockResolvedValue({ status: 'ok', analysis: snapshot('in-progress', 1, 6) });
    const { scanner, clock } = setup(client);
    const started = clock.time;
    const result = report(await scanner.quickScan('https://new.test/'));
    expect(clock.time - started).toBeLessThanOrEqual(SCANNING.quickScanDeadlineMs);
    expect(client.submitUrl).toHaveBeenCalledTimes(1);
    expect(client.getAnalysis).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ state: 'partial', verdict: 'suspicious', analysisId: 'an-1', ratio: { detected: 1, total: 7 } });
  });

  it('shows "processing" — never Safe — when no vendor finished in time', async () => {
    const client = notFound();
    client.getAnalysis.mockResolvedValue({ status: 'ok', analysis: snapshot('queued') });
    const { scanner } = setup(client);
    const result = report(await scanner.quickScan('https://new.test/'));
    expect(result.state).toBe('processing');
    expect(result.verdict).toBe('unknown');
  });

  it('treats clean-so-far partial results as Unknown', async () => {
    const client = notFound();
    client.getAnalysis.mockResolvedValue({ status: 'ok', analysis: snapshot('in-progress', 0, 9) });
    const { scanner } = setup(client);
    expect(report(await scanner.quickScan('https://new.test/')).verdict).toBe('unknown');
  });

  it('stops early and caches when the analysis completes inside the window', async () => {
    const client = notFound();
    client.getAnalysis.mockResolvedValue({ status: 'ok', analysis: snapshot('completed', 0, 9) });
    const { scanner, service } = setup(client);
    const result = report(await scanner.quickScan('https://new.test/'));
    expect(result).toMatchObject({ state: 'complete', verdict: 'safe' });
    expect(client.getAnalysis).toHaveBeenCalledTimes(1);
    expect((await service.peek('url', 'https://new.test/'))?.analysisId).toBe('an-1');
  });

  it('maps failures to friendly error states', async () => {
    const cases: Array<[Parameters<typeof fakeClient>[0], string | null, string]> = [
      [{}, null, 'missing-key'],
      [{ status: 'invalid-key', summary: null, core: null }, TEST_KEY, 'invalid-key'],
      [{ status: 'forbidden', summary: null, core: null }, TEST_KEY, 'forbidden'],
      [{ status: 'quota-exceeded', summary: null, core: null }, TEST_KEY, 'rate-limited'],
      [{ status: 'unreachable', summary: null, core: null }, TEST_KEY, 'offline'],
      [{ status: 'error', summary: null, core: null }, TEST_KEY, 'server-error'],
    ];
    for (const [result, key, code] of cases) {
      await chrome.storage.session.remove('vt.rate');
      const outcome = await setup(fakeClient(result), key).scanner.quickScan('https://x.test/');
      expect(outcome.kind === 'error' && outcome.error.code, code).toBe(code);
    }
  });

  it('rejects invalid URLs before any request', async () => {
    const { scanner, client } = setup();
    for (const input of ['', 'hello', 'javascript:alert(1)', 'ftp://files.test/x', 'http://']) {
      const outcome = await scanner.quickScan(input);
      expect(outcome.kind === 'error' && outcome.error.code, input).toBe('invalid-url');
    }
    expect(client.getUrlReport).not.toHaveBeenCalled();
  });
});

describe('UrlScanner.fullScan (Advanced Analysis)', () => {
  it('submits, polls until complete with no timeout, then builds the full report', async () => {
    const client = fakeClient({ core: sampleCore(2, 'url', 'https://evil.test/'), raw: '{"x":1}' });
    const running = Array.from({ length: 8 }, () => ({ status: 'ok' as const, analysis: snapshot('in-progress', 1, 3) }));
    for (const value of running) client.getAnalysis.mockResolvedValueOnce(value);
    client.getAnalysis.mockResolvedValue({ status: 'ok', analysis: snapshot('completed', 2, 60) });
    const { scanner, clock } = setup(client);
    const phases: string[] = [];

    const result = await scanner.fullScan('https://evil.test/', { onProgress: (p) => void phases.push(p.phase) });

    expect(client.getAnalysis).toHaveBeenCalledTimes(9);
    expect(clock.sleeps[0]).toBe(SCANNING.fullAnalysisFirstPollMs);
    expect(clock.sleeps.slice(1).every((ms) => ms >= SCANNING.fullAnalysisPollMs || ms > 0)).toBe(true);
    expect(clock.time - 1_000_000).toBeGreaterThan(60_000); // well beyond Scan Now's 6 s
    expect(phases[0]).toBe('submitting');
    expect(phases).toContain('in-progress');
    expect(phases.at(-1)).toBe('fetching-report');
    expect(result).toMatchObject({ state: 'complete', verdict: 'dangerous', analysisId: 'an-1', raw: '{"x":1}' });
    expect(client.getUrlReport).toHaveBeenCalledTimes(1);
    expect(client.getDomainReport).toHaveBeenCalledTimes(1);
  });

  it('tolerates a few early 404s for a fresh analysis id', async () => {
    const client = fakeClient();
    client.getAnalysis
      .mockResolvedValueOnce({ status: 'not-found', analysis: null })
      .mockResolvedValueOnce({ status: 'not-found', analysis: null })
      .mockResolvedValue({ status: 'ok', analysis: snapshot('completed', 0, 5) });
    const { scanner } = setup(client);
    expect((await scanner.fullScan('https://example.com/')).state).toBe('complete');
  });

  it('can be cancelled mid-poll', async () => {
    const client = fakeClient();
    client.getAnalysis.mockResolvedValue({ status: 'ok', analysis: snapshot('queued') });
    const { scanner } = setup(client);
    const controller = new AbortController();
    let polls = 0;
    const run = scanner.fullScan('https://example.com/', {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.polls > 0 && ++polls === 2) controller.abort();
      },
    });
    await expect(run).rejects.toThrow(/abort/i);
    expect(client.getAnalysis.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('fails with a friendly error when submission is refused', async () => {
    const client = fakeClient();
    client.submitUrl.mockResolvedValue({ status: 'invalid-key', analysisId: null });
    const { scanner } = setup(client);
    await expect(scanner.fullScan('https://example.com/')).rejects.toMatchObject({ code: 'invalid-key' });
  });

  it('falls back to the finished analysis if the URL object is not indexed yet', async () => {
    const client = fakeClient({ status: 'not-found', summary: null, core: null });
    client.getAnalysis.mockResolvedValue({ status: 'ok', analysis: snapshot('completed', 3, 40) });
    const { scanner } = setup(client);
    const result = await scanner.fullScan('https://new.test/');
    expect(result).toMatchObject({ state: 'complete', verdict: 'dangerous', ratio: { detected: 3, total: 43 } });
    expect(result.url?.url).toBe('https://new.test/');
  });
});
