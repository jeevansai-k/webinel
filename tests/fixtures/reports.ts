import { buildReport } from '../../src/services/ReportBuilder';
import type { AnalysisJob, ScanReport } from '../../src/shared/scan';
import { sampleCore } from '../integration/helpers';

export function urlReport(malicious = 3, overrides: Partial<ScanReport> = {}): ScanReport {
  const report = buildReport('url', sampleCore(malicious, 'url', 'https://evil.test/login'), {
    state: 'complete',
    analysisId: 'an-1',
    domain: {
      domain: 'evil.test',
      ipAddresses: ['203.0.113.9'],
      dns: [
        { type: 'A', value: '203.0.113.9', ttl: 300 },
        { type: 'MX', value: '10 mail.evil.test', ttl: 3600 },
      ],
      certificate: { issuer: "Let's Encrypt (R11)", subject: 'evil.test', validFrom: Date.UTC(2026, 0, 1), validTo: Date.UTC(2026, 3, 1), fingerprint: 'ab'.repeat(32) },
      whois: [{ label: 'Registrar', value: 'Example Registrar' }],
      categories: ['Finance'],
      reputation: -5,
    },
    raw: '{"last_http_response_code": 200, "note": "<script>"}',
    now: 0,
  });
  return {
    ...report,
    votes: { harmless: 2, malicious: 9 },
    reputation: -12,
    categories: ['Phishing'],
    url: { ...report.url!, title: 'Sign in', redirectChain: ['https://evil.test/login', 'https://hop.test/', 'https://final.test/'] },
    ...overrides,
  };
}

export function fileScanReport(malicious = 2): ScanReport {
  const core = sampleCore(malicious, 'file', 'setup.exe');
  return buildReport('file', { ...core, file: { fileName: 'setup.exe', sha256: 'c'.repeat(64), mimeType: 'application/x-msdownload', fileType: 'Win32 EXE', size: 2048 } }, { state: 'complete', now: 0 });
}

export function job(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: 'job-1',
    kind: 'url',
    target: 'https://evil.test/login',
    phase: 'in-progress',
    startedAt: Date.now() - 12_000,
    updatedAt: Date.now(),
    polls: 2,
    analysisId: 'an-1',
    report: null,
    error: null,
    ...overrides,
  };
}
