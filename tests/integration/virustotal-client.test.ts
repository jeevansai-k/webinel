import { describe, expect, it, vi } from 'vitest';
import { statusFromHttp, VirusTotalClient } from '../../src/api/VirusTotalClient';
import { analysisObject, domainObject, fileObject, urlObject } from '../fixtures/virustotal';

const API_KEY = 'a'.repeat(64);

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const domainBody = {
  data: {
    id: 'evil.test',
    attributes: {
      last_analysis_stats: { malicious: 3, suspicious: 1, harmless: 50, undetected: 10 },
      last_analysis_results: {
        EngineA: { category: 'malicious', engine_name: 'EngineA' },
        EngineB: { category: 'harmless', engine_name: 'EngineB' },
        EngineC: { category: 'suspicious', engine_name: 'EngineC' },
      },
      last_analysis_date: 1_700_000_000,
      reputation: -12,
    },
  },
};

describe('VirusTotalClient', () => {
  it('sends the key only in the x-apikey header, never in the URL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, domainBody));
    await new VirusTotalClient(fetchMock).getDomainReport('evil.test', API_KEY);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.virustotal.com/api/v3/domains/evil.test');
    expect(url).not.toContain(API_KEY);
    expect((init.headers as Record<string, string>)['x-apikey']).toBe(API_KEY);
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('parses analysis stats, flagged engines and permalink', async () => {
    const result = await new VirusTotalClient(async () => jsonResponse(200, domainBody)).getDomainReport('evil.test', API_KEY);
    expect(result.status).toBe('ok');
    expect(result.summary).toMatchObject({
      stats: { malicious: 3, suspicious: 1, harmless: 50, undetected: 10 },
      reputation: -12,
      flaggedBy: ['EngineA', 'EngineC'],
      lastAnalysisDate: 1_700_000_000_000,
      permalink: 'https://www.virustotal.com/gui/domain/evil.test',
    });
  });

  it('uses the unpadded base64url URL identifier', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(404));
    const result = await new VirusTotalClient(fetchMock).getUrlReport('https://example.com/?a=1', API_KEY);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://www.virustotal.com/api/v3/urls/aHR0cHM6Ly9leGFtcGxlLmNvbS8_YT0x`);
    expect(result).toMatchObject({ status: 'not-found', summary: null, core: null });
  });

  it('routes IP hosts to the ip_addresses endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(404));
    await new VirusTotalClient(fetchMock).getDomainReport('10.0.0.1', API_KEY);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/ip_addresses/10.0.0.1');
  });

  it('maps HTTP and network failures to lookup states', async () => {
    expect(statusFromHttp(401)).toBe('invalid-key');
    expect(statusFromHttp(403)).toBe('forbidden');
    expect(statusFromHttp(404)).toBe('not-found');
    expect(statusFromHttp(429)).toBe('quota-exceeded');
    expect(statusFromHttp(500)).toBe('error');
    const offline = await new VirusTotalClient(async () => Promise.reject(new TypeError('offline'))).getDomainReport('a.test', API_KEY);
    expect(offline.status).toBe('unreachable');
    const badJson = await new VirusTotalClient(async () => new Response('<html>', { status: 200 })).getDomainReport('a.test', API_KEY);
    expect(badJson.status).toBe('error');
  });

  it('refuses malformed file hashes without calling the network', async () => {
    const fetchMock = vi.fn();
    const result = await new VirusTotalClient(fetchMock).getFileReport('../../etc', API_KEY);
    expect(result.status).toBe('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns full URL, file and domain objects', async () => {
    const client = (body: unknown) => new VirusTotalClient(async () => jsonResponse(200, body));
    const url = await client(urlObject).getUrlReport('https://evil.test/login', API_KEY);
    expect(url.core?.url?.httpStatus).toBe(200);
    expect(url.summary?.stats.malicious).toBe(3);
    expect(url.summary?.flaggedBy).toEqual(['EngineA', 'EngineD', 'Zulu', 'EngineC']);
    expect(url.raw).toContain('last_final_url');
    const file = await client(fileObject).getFileReport('A'.repeat(64), API_KEY, { fileName: 'setup.exe' });
    expect(file.core?.file).toMatchObject({ fileName: 'setup.exe', sha256: 'a'.repeat(64) });
    const domain = await client(domainObject).getDomainReport('evil.test', API_KEY);
    expect(domain.intel?.ipAddresses).toEqual(['203.0.113.9', '2001:db8::9']);
  });

  it('uploads files as multipart form data', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: { type: 'analysis', id: 'f-1' } }));
    const result = await new VirusTotalClient(fetchMock).uploadFile(new Blob(['hello']), 'hello.txt', API_KEY);
    expect(result).toEqual({ status: 'ok', analysisId: 'f-1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.virustotal.com/api/v3/files');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(((init.body as FormData).get('file') as File).name).toBe('hello.txt');
    expect((init.headers as Record<string, string>)['x-apikey']).toBe(API_KEY);
  });

  it('polls analyses by id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, analysisObject('in-progress')));
    const result = await new VirusTotalClient(fetchMock).getAnalysis('u-abc-123', API_KEY);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://www.virustotal.com/api/v3/analyses/u-abc-123');
    expect(result.analysis?.status).toBe('in-progress');
    const missing = await new VirusTotalClient(async () => jsonResponse(404)).getAnalysis('gone', API_KEY);
    expect(missing).toEqual({ status: 'not-found', analysis: null });
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    const result = await new VirusTotalClient(fetchMock).getAnalysis('x', API_KEY, { signal: controller.signal });
    expect(result.status).toBe('unreachable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits URLs as a form POST', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: { type: 'analysis', id: 'x' } }));
    expect(await new VirusTotalClient(fetchMock).submitUrl('https://new.test/', API_KEY)).toEqual({ status: 'ok', analysisId: 'x' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/urls$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('url=https%3A%2F%2Fnew.test%2F');
  });
});
