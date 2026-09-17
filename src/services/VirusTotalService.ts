/**
 * Orchestrates VirusTotal access: Smart Cache → rate limiter → network.
 * Background-only — it is the sole reader of the API key.
 */
import {
  VirusTotalClient,
  type AnalysisResult,
  type SubmissionResult,
  type VirusTotalResult,
} from '../api/VirusTotalClient';
import { VIRUSTOTAL } from '../shared/config';
import type { DomainIntel, ScanCore } from '../shared/scan';
import type { ApiHealth, VirusTotalLookupStatus, VirusTotalSummary } from '../shared/verdict';
import { SecretStore } from '../storage/SecretStore';
import { statsStore } from '../storage/StatsStore';
import { getRegistrableDomain } from '../utils/domain';
import { getHost } from '../utils/url';
import { defaultSleep, RateLimiter } from './RateLimiter';
import { SmartCache, type CacheEntry, type CacheNamespace } from './SmartCache';

export interface LookupOutcome {
  status: VirusTotalLookupStatus;
  summary: VirusTotalSummary | null;
  core: ScanCore | null;
  intel: DomainIntel | null;
  raw: string | null;
  analysisId: string | null;
  fromCache: boolean;
  /** An expired/must-refresh cache entry served because VirusTotal failed. */
  stale: boolean;
  /** When `stale`, the failure that forced the fallback. */
  failure: VirusTotalLookupStatus | null;
  cachedAt: number | null;
}

export interface CallOptions {
  /** Bypass the cache (still falls back to it when VirusTotal fails). */
  force?: boolean;
  signal?: AbortSignal;
  /** Wait for a rate-limit slot instead of failing fast. */
  wait?: boolean;
  /** Absolute time after which waiting for a slot is pointless. */
  deadline?: number;
  fileName?: string;
}

export interface VirusTotalServiceDeps {
  client?: VirusTotalClient;
  secrets?: SecretStore;
  cache?: SmartCache;
  limiter?: RateLimiter;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  countRequest?: () => Promise<unknown>;
  countCacheHit?: () => Promise<unknown>;
}

/** Failures after which a cached copy is better than nothing. */
const FALLBACK_STATUSES: ReadonlySet<VirusTotalLookupStatus> = new Set([
  'unreachable',
  'rate-limited',
  'quota-exceeded',
  'error',
]);

function outcome(partial: Partial<LookupOutcome> & Pick<LookupOutcome, 'status'>): LookupOutcome {
  return {
    summary: null,
    core: null,
    intel: null,
    raw: null,
    analysisId: null,
    fromCache: false,
    stale: false,
    failure: null,
    cachedAt: null,
    ...partial,
  };
}

/** Puts back the identifying fields the cache deliberately does not store. */
function rehydrate(namespace: CacheNamespace, target: string, entry: CacheEntry): CacheEntry {
  if (namespace === 'url' && entry.core?.url) {
    return { ...entry, core: { ...entry.core, url: { ...entry.core.url, url: target, domain: getHost(target) ?? '' } } };
  }
  if (namespace === 'domain') {
    const permalink = `${VIRUSTOTAL.guiUrl}/domain/${encodeURIComponent(target)}`;
    return {
      ...entry,
      summary: entry.summary ? { ...entry.summary, permalink } : null,
      intel: entry.intel ? { ...entry.intel, domain: getRegistrableDomain(target) } : null,
    };
  }
  return entry;
}

export class VirusTotalService {
  private readonly client: VirusTotalClient;
  private readonly secrets: SecretStore;
  readonly cache: SmartCache;
  private readonly limiter: RateLimiter;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly countRequest: () => Promise<unknown>;
  private readonly countCacheHit: () => Promise<unknown>;
  /** Concurrent lookups of the same target share one request. */
  private readonly inFlight = new Map<string, Promise<LookupOutcome>>();

  constructor(deps: VirusTotalServiceDeps = {}) {
    this.client = deps.client ?? new VirusTotalClient();
    this.secrets = deps.secrets ?? new SecretStore();
    this.cache = deps.cache ?? new SmartCache();
    this.limiter = deps.limiter ?? new RateLimiter();
    this.sleep = deps.sleep ?? defaultSleep;
    this.countRequest = deps.countRequest ?? (() => statsStore.increment('virusTotalRequests'));
    this.countCacheHit = deps.countCacheHit ?? (() => statsStore.increment('cacheHits'));
  }

  hasApiKey(): Promise<boolean> {
    return this.secrets.hasApiKey();
  }

  lookup(namespace: CacheNamespace, target: string, options: CallOptions = {}): Promise<LookupOutcome> {
    const flightKey = `${namespace}|${target}|${options.force ? 'f' : ''}`;
    const existing = this.inFlight.get(flightKey);
    if (existing) return existing;
    const pending = this.performLookup(namespace, target, options).finally(() => this.inFlight.delete(flightKey));
    this.inFlight.set(flightKey, pending);
    return pending;
  }

  /** Cache only — never touches the network. */
  async peek(namespace: CacheNamespace, target: string): Promise<LookupOutcome | null> {
    const hit = await this.cache.get(namespace, target);
    if (!hit) return null;
    return outcome({ ...rehydrate(namespace, target, hit.entry), fromCache: true, stale: !hit.fresh, cachedAt: hit.entry.storedAt });
  }

  private async performLookup(namespace: CacheNamespace, target: string, options: CallOptions): Promise<LookupOutcome> {
    const found = await this.cache.get(namespace, target);
    const hit = found ? { ...found, entry: rehydrate(namespace, target, found.entry) } : null;
    if (hit?.fresh && !options.force) {
      await this.countCacheHit();
      return outcome({ ...hit.entry, fromCache: true, cachedAt: hit.entry.storedAt });
    }

    const fallback = (failure: VirusTotalLookupStatus): LookupOutcome =>
      hit && FALLBACK_STATUSES.has(failure)
        ? outcome({ ...hit.entry, fromCache: true, stale: true, failure, cachedAt: hit.entry.storedAt })
        : outcome({ status: failure });

    const apiKey = await this.secrets.readApiKey();
    if (!apiKey) return outcome({ status: 'no-key' });
    if (!(await this.reserve(options))) return fallback('rate-limited');

    const result = await this.callLookup(namespace, target, apiKey, options);
    await this.afterRequest(result.status);
    if (result.status !== 'ok' && result.status !== 'not-found') return fallback(result.status);

    const analysisId = hit?.entry.analysisId ?? null;
    await this.cache.set(namespace, target, { ...result, analysisId });
    return outcome({
      status: result.status,
      summary: result.summary,
      core: result.core ?? null,
      intel: result.intel ?? null,
      raw: result.raw ?? null,
      analysisId,
    });
  }

  private callLookup(namespace: CacheNamespace, target: string, apiKey: string, options: CallOptions): Promise<VirusTotalResult> {
    switch (namespace) {
      case 'domain':
        return this.client.getDomainReport(target, apiKey, options);
      case 'url':
        return this.client.getUrlReport(target, apiKey, options);
      case 'file':
        return this.client.getFileReport(target, apiKey, options);
    }
  }

  /** Stores a completed analysis so later lookups can reuse it. */
  async remember(namespace: CacheNamespace, target: string, core: ScanCore, analysisId: string | null): Promise<void> {
    const summary: VirusTotalSummary = {
      stats: core.stats,
      reputation: core.reputation ?? 0,
      flaggedBy: [],
      lastAnalysisDate: core.lastAnalysisDate,
      permalink: core.permalink ?? '',
    };
    await this.cache.set(namespace, target, { status: 'ok', summary, core, analysisId });
  }

  async submitUrl(url: string, options: CallOptions = {}): Promise<SubmissionResult> {
    return this.withKey(options, async (apiKey) => {
      const result = await this.client.submitUrl(url, apiKey, options);
      if (result.status === 'ok') await this.cache.invalidate('url', url);
      return result;
    });
  }

  async uploadFile(file: Blob, fileName: string, options: CallOptions = {}): Promise<SubmissionResult> {
    return this.withKey(options, (apiKey) => this.client.uploadFile(file, fileName, apiKey, options));
  }

  async getAnalysis(analysisId: string, options: CallOptions = {}): Promise<AnalysisResult> {
    const result = await this.withKey<AnalysisResult>(options, (apiKey) => this.client.getAnalysis(analysisId, apiKey, options));
    return 'analysis' in result ? result : { status: result.status, analysis: null };
  }

  /** API Health Checker: verifies the key and VirusTotal reachability with one request. */
  async checkHealth(): Promise<ApiHealth> {
    const checkedAt = Date.now();
    const apiKey = await this.secrets.readApiKey();
    if (!apiKey) return { state: 'no-key', checkedAt, latencyMs: null };

    await this.limiter.record();
    const result = await this.client.getDomainReport(VIRUSTOTAL.healthProbeDomain, apiKey);
    await this.afterRequest(result.status);
    switch (result.status) {
      case 'ok':
      case 'not-found':
        return { state: 'online', checkedAt, latencyMs: result.latencyMs };
      case 'invalid-key':
      case 'forbidden':
        return { state: 'invalid-key', checkedAt, latencyMs: result.latencyMs };
      case 'quota-exceeded':
        return { state: 'quota-exceeded', checkedAt, latencyMs: result.latencyMs };
      default:
        return { state: 'unreachable', checkedAt, latencyMs: result.latencyMs };
    }
  }

  private async withKey<T extends { status: VirusTotalLookupStatus }>(
    options: CallOptions,
    call: (apiKey: string) => Promise<T>,
  ): Promise<T | { status: VirusTotalLookupStatus; analysisId: null }> {
    const apiKey = await this.secrets.readApiKey();
    if (!apiKey) return { status: 'no-key', analysisId: null };
    if (!(await this.reserve(options))) return { status: 'rate-limited', analysisId: null };
    const result = await call(apiKey);
    await this.afterRequest(result.status);
    return result;
  }

  private reserve(options: CallOptions): Promise<boolean> {
    if (!options.wait) return this.limiter.tryAcquire();
    return this.limiter.acquire({ signal: options.signal, deadline: options.deadline, sleep: this.sleep });
  }

  private async afterRequest(status: VirusTotalLookupStatus): Promise<void> {
    if (status !== 'unreachable') await this.countRequest();
    if (status === 'quota-exceeded') await this.limiter.coolDown();
  }
}
