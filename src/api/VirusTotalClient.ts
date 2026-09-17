/**
 * Isolated HTTP client for the VirusTotal v3 API.
 * - The key travels only in the `x-apikey` header — never in a URL — and is never logged.
 * - HTTP failures (401/403/404/429/5xx, network) become lookup statuses; raw API
 *   errors never reach the UI.
 * - No caching or rate limiting here; see VirusTotalService.
 */
import { VIRUSTOTAL } from '../shared/config';
import type { DomainIntel, ScanCore } from '../shared/scan';
import type { VirusTotalLookupStatus, VirusTotalSummary } from '../shared/verdict';
import { isIpAddress } from '../utils/domain';
import { toVirusTotalUrlId } from '../utils/hash';
import {
  analysisIdFrom,
  parseAnalysis,
  parseDomainObject,
  parseFileObject,
  parseStats,
  parseUrlObject,
  parseVendors,
  summaryFrom,
  trimRaw,
  type AnalysisSnapshot,
} from './parsers';

export interface VirusTotalResult {
  status: VirusTotalLookupStatus;
  summary: VirusTotalSummary | null;
  latencyMs: number | null;
  /** URL and file lookups: the full parsed object. */
  core?: ScanCore | null;
  /** Domain lookups: DNS, certificate, WHOIS. */
  intel?: DomainIntel | null;
  raw?: string | null;
}

export interface SubmissionResult {
  status: VirusTotalLookupStatus;
  analysisId: string | null;
}

export interface AnalysisResult {
  status: VirusTotalLookupStatus;
  analysis: AnalysisSnapshot | null;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

type FetchFn = typeof fetch;

interface RawResponse {
  status: VirusTotalLookupStatus;
  body: unknown;
  latencyMs: number | null;
}

export function statusFromHttp(httpStatus: number): VirusTotalLookupStatus {
  if (httpStatus >= 200 && httpStatus < 300) return 'ok';
  if (httpStatus === 404) return 'not-found';
  if (httpStatus === 401) return 'invalid-key';
  if (httpStatus === 403) return 'forbidden';
  if (httpStatus === 429) return 'quota-exceeded';
  return 'error';
}

/** Kept for callers that only need the verdict-level summary. */
export function parseSummary(body: unknown, permalink: string): VirusTotalSummary {
  const attributes = ((body as { data?: { attributes?: Record<string, unknown> } })?.data?.attributes ?? {}) as Record<string, unknown>;
  const vendors = parseVendors(attributes.last_analysis_results);
  const date = typeof attributes.last_analysis_date === 'number' ? attributes.last_analysis_date * 1000 : null;
  const reputation = typeof attributes.reputation === 'number' ? attributes.reputation : null;
  return summaryFrom(parseStats(attributes.last_analysis_stats), vendors, reputation, date, permalink);
}

export class VirusTotalClient {
  constructor(
    private readonly fetchImpl: FetchFn = (...args) => fetch(...args),
    private readonly baseUrl: string = VIRUSTOTAL.baseUrl,
    private readonly timeoutMs: number = VIRUSTOTAL.timeoutMs,
  ) {}

  async getDomainReport(host: string, apiKey: string, options: RequestOptions = {}): Promise<VirusTotalResult> {
    const ip = isIpAddress(host);
    const target = encodeURIComponent(host.replace(/^\[|\]$/g, ''));
    const permalink = `${VIRUSTOTAL.guiUrl}/${ip ? 'ip-address' : 'domain'}/${target}`;
    const response = await this.request(`/${ip ? 'ip_addresses' : 'domains'}/${target}`, apiKey, { method: 'GET' }, options);
    if (response.status !== 'ok') return { status: response.status, summary: null, latencyMs: response.latencyMs, intel: null };
    const intel = parseDomainObject(response.body, host);
    if (ip) intel.ipAddresses = [host];
    return {
      status: 'ok',
      summary: parseSummary(response.body, permalink),
      latencyMs: response.latencyMs,
      intel,
      raw: trimRaw(response.body),
    };
  }

  async getUrlReport(url: string, apiKey: string, options: RequestOptions = {}): Promise<VirusTotalResult> {
    const response = await this.request(`/urls/${toVirusTotalUrlId(url)}`, apiKey, { method: 'GET' }, options);
    if (response.status !== 'ok') return { status: response.status, summary: null, latencyMs: response.latencyMs, core: null };
    const core = parseUrlObject(response.body, url);
    return {
      status: 'ok',
      summary: summaryFrom(core.stats, core.vendors, core.reputation, core.lastAnalysisDate, core.permalink ?? ''),
      latencyMs: response.latencyMs,
      core,
      raw: trimRaw(response.body),
    };
  }

  async getFileReport(sha256: string, apiKey: string, options: RequestOptions & { fileName?: string } = {}): Promise<VirusTotalResult> {
    if (!/^[a-f0-9]{64}$/i.test(sha256)) return { status: 'error', summary: null, latencyMs: null, core: null };
    const hash = sha256.toLowerCase();
    const response = await this.request(`/files/${hash}`, apiKey, { method: 'GET' }, options);
    if (response.status !== 'ok') return { status: response.status, summary: null, latencyMs: response.latencyMs, core: null };
    const core = parseFileObject(response.body, hash, options.fileName ?? hash);
    return {
      status: 'ok',
      summary: summaryFrom(core.stats, core.vendors, core.reputation, core.lastAnalysisDate, core.permalink ?? ''),
      latencyMs: response.latencyMs,
      core,
      raw: trimRaw(response.body),
    };
  }

  /** Queues a URL for analysis. Only ever called after an explicit user action. */
  async submitUrl(url: string, apiKey: string, options: RequestOptions = {}): Promise<SubmissionResult> {
    const response = await this.request(
      '/urls',
      apiKey,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url }).toString(),
      },
      options,
    );
    return { status: response.status, analysisId: response.status === 'ok' ? analysisIdFrom(response.body) : null };
  }

  /** Uploads a file (≤ 32 MB). Only ever called after the user consented. */
  async uploadFile(file: Blob, fileName: string, apiKey: string, options: RequestOptions = {}): Promise<SubmissionResult> {
    const form = new FormData();
    form.append('file', file, fileName);
    const response = await this.request('/files', apiKey, { method: 'POST', body: form }, options, 5 * 60_000);
    return { status: response.status, analysisId: response.status === 'ok' ? analysisIdFrom(response.body) : null };
  }

  async getAnalysis(analysisId: string, apiKey: string, options: RequestOptions = {}): Promise<AnalysisResult> {
    const response = await this.request(`/analyses/${encodeURIComponent(analysisId)}`, apiKey, { method: 'GET' }, options);
    return { status: response.status, analysis: response.status === 'ok' ? parseAnalysis(response.body) : null };
  }

  private async request(
    path: string,
    apiKey: string,
    init: RequestInit,
    options: RequestOptions,
    timeoutMs = this.timeoutMs,
  ): Promise<RawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const started = Date.now();
    try {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { accept: 'application/json', ...(init.headers as Record<string, string>), 'x-apikey': apiKey },
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      const status = statusFromHttp(response.status);
      const body = status === 'ok' ? await response.json().catch(() => null) : null;
      return { status: status === 'ok' && body === null ? 'error' : status, body, latencyMs };
    } catch {
      return { status: 'unreachable', body: null, latencyMs: null };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}
