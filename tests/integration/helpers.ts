import { vi } from 'vitest';
import type { AnalysisSnapshot } from '../../src/api/parsers';
import type { AnalysisResult, SubmissionResult, VirusTotalClient, VirusTotalResult } from '../../src/api/VirusTotalClient';
import { detectionRatio } from '../../src/api/parsers';
import { RateLimiter } from '../../src/services/RateLimiter';
import type { ScannerClock } from '../../src/services/UrlScanner';
import { VirusTotalService } from '../../src/services/VirusTotalService';
import type { ScanCore, VendorResult } from '../../src/shared/scan';
import type { VirusTotalStats, VirusTotalSummary } from '../../src/shared/verdict';
import type { SecretStore } from '../../src/storage/SecretStore';
import { LocalStore } from '../../src/storage/LocalStore';

export const TEST_KEY = 'b'.repeat(64);

export function vtSummary(malicious: number, suspicious = 0): VirusTotalSummary {
  return {
    stats: { malicious, suspicious, harmless: 60, undetected: 8 },
    reputation: 0,
    flaggedBy: [],
    lastAnalysisDate: null,
    permalink: 'https://www.virustotal.com/gui/domain/x',
  };
}

export function vendorList(malicious: number, clean: number): VendorResult[] {
  return [
    ...Array.from({ length: malicious }, (_, i) => ({ engine: `Bad${i}`, verdict: 'malicious' as const, category: 'malicious', label: 'Phishing' })),
    ...Array.from({ length: clean }, (_, i) => ({ engine: `Good${i}`, verdict: 'clean' as const, category: 'harmless', label: null })),
  ];
}

export function sampleCore(malicious: number, kind: 'url' | 'file' = 'url', target = 'https://example.com/'): ScanCore {
  const stats: VirusTotalStats = { malicious, suspicious: 0, harmless: 60, undetected: 8 };
  return {
    stats,
    vendors: vendorList(malicious, 3),
    ratio: detectionRatio(stats),
    reputation: 0,
    votes: null,
    firstSeen: 1_700_000_000_000,
    lastAnalysisDate: 1_700_000_100_000,
    permalink: 'https://www.virustotal.com/gui/x',
    categories: [],
    threats: malicious ? ['Phishing'] : [],
    url:
      kind === 'url'
        ? { url: target, finalUrl: null, domain: new URL(target).hostname, title: null, httpStatus: 200, contentType: 'text/html', ipAddresses: [], redirectChain: [] }
        : null,
    file: kind === 'file' ? { fileName: target, sha256: 'a'.repeat(64), mimeType: null, fileType: 'PDF', size: 10 } : null,
  };
}

export function snapshot(status: AnalysisSnapshot['status'], malicious = 0, harmless = 0): AnalysisSnapshot {
  return {
    status,
    stats: { malicious, suspicious: 0, harmless, undetected: 0 },
    vendors: vendorList(malicious, harmless),
    date: status === 'completed' ? 1_700_000_200_000 : null,
    url: null,
    sha256: null,
  };
}

export function fakeSecrets(key: string | null = TEST_KEY): SecretStore {
  return {
    hasApiKey: vi.fn(async () => key !== null),
    readApiKey: vi.fn(async () => key),
    saveApiKey: vi.fn(),
    clearApiKey: vi.fn(),
  } as unknown as SecretStore;
}

export function fakeClient(result: Partial<VirusTotalResult> = {}) {
  const value: VirusTotalResult = { status: 'ok', summary: vtSummary(0), latencyMs: 42, core: sampleCore(0), intel: null, raw: '{}', ...result };
  return {
    getDomainReport: vi.fn(async (_host: string, _apiKey: string, _options?: unknown): Promise<VirusTotalResult> => value),
    getUrlReport: vi.fn(async (_url: string, _apiKey: string, _options?: unknown): Promise<VirusTotalResult> => value),
    getFileReport: vi.fn(async (_sha256: string, _apiKey: string, _options?: unknown): Promise<VirusTotalResult> => value),
    submitUrl: vi.fn(async (_url: string, _apiKey: string, _options?: unknown): Promise<SubmissionResult> => ({ status: 'ok', analysisId: 'an-1' })),
    uploadFile: vi.fn(async (_file: Blob, _name: string, _apiKey: string, _options?: unknown): Promise<SubmissionResult> => ({ status: 'ok', analysisId: 'an-file' })),
    getAnalysis: vi.fn(async (_id: string, _apiKey: string, _options?: unknown): Promise<AnalysisResult> => ({ status: 'ok', analysis: snapshot('completed', 0, 5) })),
  };
}

export type FakeClient = ReturnType<typeof fakeClient>;

/** Virtual time: sleeping advances the clock instantly. */
export class VirtualClock implements ScannerClock {
  time = 1_000_000;
  sleeps: number[] = [];
  now = () => this.time;
  sleep = async (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    this.sleeps.push(ms);
    this.time += ms;
  };
}

export function createService(client: FakeClient = fakeClient(), key: string | null = TEST_KEY, clock?: VirtualClock) {
  const limiter = clock
    ? new RateLimiter(new LocalStore('vt.rate', () => ({ timestamps: [] as number[], cooldownUntil: 0 }), chrome.storage.session), 4, 60_000, clock.now)
    : undefined;
  const service = new VirusTotalService({
    client: client as unknown as VirusTotalClient,
    secrets: fakeSecrets(key),
    limiter,
    sleep: clock?.sleep,
  });
  return { service, client };
}
