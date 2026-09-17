/**
 * Mandatory scanning-engine security tests:
 *  - API key never exposed
 *  - local storage only
 *  - upload requires consent
 *  - 6-second timeout respected
 *  - Unknown ≠ Safe
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisJobs } from '../../src/background/AnalysisJobs';
import { VirusTotalClient } from '../../src/api/VirusTotalClient';
import { FileScanner } from '../../src/services/FileScanner';
import { sha256OfBlob } from '../../src/services/HashService';
import { reportVerdict } from '../../src/services/ReportBuilder';
import { memoryStaging } from '../../src/services/UploadStaging';
import { systemClock, UrlScanner } from '../../src/services/UrlScanner';
import { VirusTotalService } from '../../src/services/VirusTotalService';
import { verdictChip } from '../../src/shared/components/VerdictChip';
import { detectionCircle } from '../../src/shared/components/DetectionCircle';
import { SCANNING } from '../../src/shared/config';
import { SecretStore, type CryptoKeyProvider } from '../../src/storage/SecretStore';
import { analysisJobStore } from '../../src/storage/AnalysisJobStore';
import { analysisObject, fileObject, urlObject } from '../fixtures/virustotal';
import { RateLimiter } from '../../src/services/RateLimiter';
import { LocalStore } from '../../src/storage/LocalStore';
import { snapshot, VirtualClock } from '../integration/helpers';
import { localArea, sessionArea } from '../setup/chromeMock';

const API_KEY = '5ec2e7'.repeat(10) + 'abcd';

function memoryKeys(): CryptoKeyProvider {
  const key = crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { getKey: () => key };
}

const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

/** A fake VirusTotal that records every request. */
function fakeVirusTotal(route: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    requests.push({ url, init });
    return route(url, init);
  });
  return { fetchMock, requests };
}

async function realStack(route: Parameters<typeof fakeVirusTotal>[0], clock = new VirtualClock()) {
  const secrets = new SecretStore(memoryKeys());
  await secrets.saveApiKey(API_KEY);
  const vt = fakeVirusTotal(route);
  const limiter = new RateLimiter(new LocalStore('vt.rate', () => ({ timestamps: [] as number[], cooldownUntil: 0 }), chrome.storage.session), 4, 60_000, clock.now);
  const service = new VirusTotalService({ client: new VirusTotalClient(vt.fetchMock), secrets, sleep: clock.sleep, limiter });
  return { ...vt, service, clock, urls: new UrlScanner(service, clock), files: new FileScanner(service, clock) };
}

function everythingStored(): string {
  return JSON.stringify([...localArea.data.entries(), ...sessionArea.data.entries()]);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('API key is never exposed', () => {
  it('appears only in the x-apikey header — never in URLs, bodies, reports, storage or logs', async () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const stack = await realStack((url) => {
      if (url.includes('/urls/')) return json(404);
      if (url.endsWith('/urls')) return json(200, { data: { type: 'analysis', id: 'u-1' } });
      if (url.includes('/analyses/')) return json(200, analysisObject('completed', { A: { category: 'harmless', engine_name: 'A', result: 'clean' } }));
      return json(401);
    });

    const quick = await stack.urls.quickScan('https://new.test/');
    const full = await stack.urls.fullScan('https://new.test/').catch((failure: unknown) => failure);

    const outputs = JSON.stringify([quick, full]);
    expect(outputs).not.toContain(API_KEY);
    expect(everythingStored()).not.toContain(API_KEY);
    for (const request of stack.requests) {
      expect(request.url).not.toContain(API_KEY);
      expect(String(request.init.body ?? '')).not.toContain(API_KEY);
      expect((request.init.headers as Record<string, string>)['x-apikey']).toBe(API_KEY);
    }
    for (const spy of [log, warn, error]) expect(JSON.stringify(spy.mock.calls)).not.toContain(API_KEY);
  });

  it('never returns raw VirusTotal error bodies', async () => {
    const stack = await realStack(() => new Response('{"error":{"code":"WrongCredentialsError","message":"secret internals"}}', { status: 401 }));
    const outcome = await stack.urls.quickScan('https://x.test/');
    expect(outcome).toEqual({
      kind: 'error',
      error: expect.objectContaining({ code: 'invalid-key', title: 'VirusTotal rejected the API key.' }),
    });
    expect(JSON.stringify(outcome)).not.toMatch(/WrongCredentialsError|secret internals/);
  });
});

describe('Local storage only', () => {
  it('talks to nobody but VirusTotal and stores nothing in sync storage', async () => {
    const stack = await realStack((url) => (url.includes('/files/') ? json(200, fileObject) : json(200, urlObject)));
    await stack.urls.quickScan('https://evil.test/login');
    await stack.files.lookup({ fileName: 'a.exe', sha256: 'a'.repeat(64), size: 10, mimeType: null });
    expect(stack.requests.length).toBeGreaterThan(0);
    for (const request of stack.requests) {
      expect(new URL(request.url).origin).toBe('https://www.virustotal.com');
      expect(request.init.credentials).toBe('omit');
    }
    expect('sync' in chrome.storage).toBe(false);
    // Cache keys are hashes and entries carry no URL, domain or file name.
    const stored = everythingStored();
    for (const needle of ['evil.test', 'landing.evil', 'Sign in', 'a.exe']) expect(stored, needle).not.toContain(needle);
  });

  it('rebuilds identifying fields from the lookup key when reading the cache', async () => {
    const clean = structuredClone(urlObject);
    clean.data.attributes.last_analysis_stats = { malicious: 0, suspicious: 0, harmless: 60, undetected: 10, timeout: 0 };
    const stack = await realStack(() => json(200, clean));
    await stack.urls.quickScan('https://evil.test/login');
    const again = await stack.urls.quickScan('https://evil.test/login');
    expect(again).toMatchObject({ kind: 'report', report: { source: 'cache', url: { url: 'https://evil.test/login', domain: 'evil.test' } } });
  });

  it('keeps analysis jobs in session storage, not persistent storage', async () => {
    await analysisJobStore.put({ id: 'j', kind: 'url', target: 'https://a.test/', phase: 'queued', startedAt: 1, updatedAt: 1, polls: 0, analysisId: null, report: null, error: null });
    expect(sessionArea.data.has('analysis.jobs')).toBe(true);
    expect(localArea.data.has('analysis.jobs')).toBe(false);
  });
});

describe('Upload requires consent', () => {
  async function uploadSetup() {
    const stack = await realStack((url) => {
      if (url.endsWith('/files')) return json(200, { data: { type: 'analysis', id: 'f-1' } });
      if (url.includes('/analyses/')) return json(200, analysisObject('completed'));
      if (url.includes('/files/')) return json(404);
      return json(500);
    });
    const staging = memoryStaging();
    const jobs = new AnalysisJobs(stack.urls, stack.files, staging);
    const blob = new Blob(['%PDF private']);
    const meta = { fileName: 'private.pdf', sha256: await sha256OfBlob(blob), size: blob.size, mimeType: 'application/pdf' };
    const uploads = () => stack.requests.filter((request) => request.url.endsWith('/files') && request.init.method === 'POST');
    return { stack, staging, jobs, blob, meta, uploads };
  }

  it('a hash lookup never uploads — it asks', async () => {
    const { stack, meta, uploads } = await uploadSetup();
    expect(await stack.files.lookup(meta)).toEqual({ kind: 'needs-upload', sha256: meta.sha256 });
    expect(uploads()).toHaveLength(0);
  });

  it('refuses at every layer without explicit consent', async () => {
    const { stack, staging, jobs, blob, meta, uploads } = await uploadSetup();
    await expect(stack.files.upload(meta, blob, { consent: false })).rejects.toMatchObject({ code: 'consent-required' });
    const stagingId = await staging.put(blob);
    await expect(jobs.startFileUpload(meta, stagingId, false)).rejects.toMatchObject({ code: 'consent-required' });
    expect(staging.size()).toBe(0); // the declined file is discarded
    expect(uploads()).toHaveLength(0);
  });

  it('uploads exactly once after consent', async () => {
    const { staging, jobs, blob, meta, uploads } = await uploadSetup();
    const jobId = await jobs.startFileUpload(meta, await staging.put(blob), true);
    await jobs.settled(jobId);
    expect(uploads()).toHaveLength(1);
  });
});

describe('6-second timeout', () => {
  it('Scan Now stops polling at the deadline even if the analysis never finishes', async () => {
    const stack = await realStack((url) => {
      if (url.includes('/urls/')) return json(404);
      if (url.endsWith('/urls')) return json(200, { data: { type: 'analysis', id: 'u-1' } });
      return json(200, analysisObject('in-progress', { A: { category: 'harmless', engine_name: 'A', result: 'clean' } }));
    });
    const started = stack.clock.time;
    const outcome = await stack.urls.quickScan('https://slow.test/');
    expect(stack.clock.time - started).toBeLessThanOrEqual(SCANNING.quickScanDeadlineMs);
    expect(outcome.kind === 'report' && outcome.report.state).toBe('partial');
    const polls = stack.requests.filter((request) => request.url.includes('/analyses/'));
    expect(polls.length).toBeGreaterThan(0);
    expect(polls.length).toBeLessThanOrEqual(SCANNING.quickScanDeadlineMs / SCANNING.quickScanPollMs);
  });

  it('aborts a hanging VirusTotal request when the 6 seconds are up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const yieldToIo = () => new Promise((resolve) => setImmediate(resolve));
    const secrets = new SecretStore(memoryKeys());
    await secrets.saveApiKey(API_KEY);
    let submitted = false;
    let pollSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes('/urls/')) return json(404);
      if (url.endsWith('/urls')) {
        submitted = true;
        return json(200, { data: { type: 'analysis', id: 'u-1' } });
      }
      pollSignal = init.signal ?? undefined;
      return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    const service = new VirusTotalService({ client: new VirusTotalClient(fetchMock), secrets });
    const scanner = new UrlScanner(service, systemClock);

    const started = Date.now();
    let settled = false;
    const run = scanner.quickScan('https://hang.test/').finally(() => (settled = true));
    while (!submitted) await yieldToIo();
    // Wait until the scanner is actually sleeping (deadline timer + poll timer) before moving time.
    while (vi.getTimerCount() < 2) await yieldToIo();
    await vi.advanceTimersByTimeAsync(SCANNING.quickScanPollMs);
    while (!pollSignal) await yieldToIo();

    // The poll hangs; the scan must still end exactly when the window closes.
    await vi.advanceTimersByTimeAsync(started + SCANNING.quickScanDeadlineMs - Date.now() - 1);
    expect(settled).toBe(false);
    expect(pollSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await run;
    expect(Date.now() - started).toBeLessThanOrEqual(SCANNING.quickScanDeadlineMs);
    expect(pollSignal.aborted).toBe(true);
    expect(outcome).toMatchObject({ kind: 'report', report: { state: 'processing', verdict: 'unknown' } });
  });

  it('reports a timeout — not a fake result — when even the lookup is too slow', async () => {
    vi.useFakeTimers();
    const secrets = new SecretStore(memoryKeys());
    await secrets.saveApiKey(API_KEY);
    const fetchMock = vi.fn((_input: RequestInfo | URL, init: RequestInit = {}) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    );
    const scanner = new UrlScanner(new VirusTotalService({ client: new VirusTotalClient(fetchMock), secrets }), systemClock);
    const run = scanner.quickScan('https://hang.test/');
    await vi.advanceTimersByTimeAsync(SCANNING.quickScanDeadlineMs);
    expect(await run).toMatchObject({ kind: 'error', error: { code: 'timeout' } });
  });

  it('Advanced Analysis has no such timeout', async () => {
    const stack = await realStack((url) => {
      if (url.endsWith('/urls')) return json(200, { data: { type: 'analysis', id: 'u-1' } });
      if (url.includes('/analyses/')) {
        const polls = stack.requests.filter((request) => request.url.includes('/analyses/')).length;
        return json(200, analysisObject(polls < 6 ? 'queued' : 'completed'));
      }
      return json(200, urlObject);
    });
    const report = await stack.urls.fullScan('https://evil.test/login');
    expect(report.state).toBe('complete');
    expect(stack.clock.time - 1_000_000).toBeGreaterThan(SCANNING.quickScanDeadlineMs * 10);
  });
});

describe('Unknown ≠ Safe', () => {
  it('scans with no verdict-bearing evidence are never Safe', async () => {
    const stack = await realStack((url) => {
      if (url.includes('/urls/')) return json(404);
      if (url.endsWith('/urls')) return json(200, { data: { type: 'analysis', id: 'u-1' } });
      return json(200, analysisObject('queued'));
    });
    const outcome = await stack.urls.quickScan('https://unknown.test/');
    expect(outcome.kind === 'report' && outcome.report.verdict).toBe('unknown');
  });

  it('clean partial, processing and stale results are Unknown and render grey', () => {
    for (const [state, stale] of [['partial', false], ['processing', false], ['complete', true]] as const) {
      expect(reportVerdict({ stats: snapshot('in-progress', 0, 40).stats }, state, stale)).toBe('unknown');
    }
    const host = document.createElement('div');
    host.innerHTML = verdictChip('unknown') + detectionCircle({ detected: 0, total: 40 }, 'unknown', 'partial');
    expect(host.querySelector('.chip--safe')).toBeNull();
    expect(host.querySelector('[data-tone="safe"]')).toBeNull();
    expect(host.textContent).not.toContain('Safe');
  });

  it('a file VirusTotal has never seen is not reported as clean', async () => {
    const stack = await realStack(() => json(404));
    const outcome = await stack.files.lookup({ fileName: 'x.pdf', sha256: 'b'.repeat(64), size: 1, mimeType: null });
    expect(outcome.kind).toBe('needs-upload');
  });
});
