/**
 * Smart Cache for VirusTotal results.
 *
 * Stored per entry: URL/file hash (the key), detection ratio, analysis id,
 * timestamp, verdict — plus the parsed report so cached scans render instantly.
 *
 * Rules (CACHE_RULES):
 * - URL and domain entries are fresh for 24 h, file entries for 7 days.
 * - Dangerous entries are never "fresh": callers must re-check, and may use the
 *   cached copy only if VirusTotal cannot be reached.
 * - Unknown ("not found") entries live 1 h.
 * - Failures are never cached.
 * - Expired entries are kept only as a labelled offline fallback, then purged.
 *
 * Each entry is its own storage key (`cache:<namespace>:<sha256>`) so a lookup
 * reads one small value; a compact index tracks age for eviction. Keys are
 * hashes, so the cache is not a readable browsing history.
 */
import { ALWAYS_REFRESH, CACHE_RULES } from '../shared/config';
import type { DetectionRatio, DomainIntel, ScanCore } from '../shared/scan';
import type { Verdict, VirusTotalLookupStatus, VirusTotalSummary } from '../shared/verdict';
import { sha256Hex } from '../utils/hash';
import { verdictFromVirusTotal } from './DecisionEngine';

export type CacheNamespace = 'domain' | 'url' | 'file';

export interface CachedLookup {
  status: VirusTotalLookupStatus;
  summary: VirusTotalSummary | null;
  core?: ScanCore | null;
  intel?: DomainIntel | null;
  analysisId?: string | null;
}

export interface CacheEntry extends CachedLookup {
  targetHash: string;
  verdict: Verdict;
  ratio: DetectionRatio | null;
  analysisId: string | null;
  storedAt: number;
  expiresAt: number;
}

export interface CacheHit {
  entry: CacheEntry;
  /** Safe to use without asking VirusTotal again. */
  fresh: boolean;
}

type CacheIndex = Record<string, number>;

const INDEX_KEY = 'cache.index';
const CACHEABLE_STATUSES: ReadonlySet<VirusTotalLookupStatus> = new Set(['ok', 'not-found']);

/**
 * Removes anything that names the scanned site or file before it is persisted.
 * Callers restore those fields from the lookup key (see VirusTotalService).
 */
export function sanitizeForCache(namespace: CacheNamespace, lookup: CachedLookup): CachedLookup {
  const core = lookup.core
    ? {
        ...lookup.core,
        url: lookup.core.url
          ? { ...lookup.core.url, url: '', finalUrl: null, domain: '', title: null, ipAddresses: [], redirectChain: [] }
          : null,
        file: lookup.core.file ? { ...lookup.core.file, fileName: '' } : null,
      }
    : null;
  const intel = lookup.intel
    ? { ...lookup.intel, domain: '', dns: [], certificate: null, whois: [] }
    : null;
  // Domain permalinks spell out the domain; URL and file permalinks are hashes.
  const summary = lookup.summary && namespace === 'domain' ? { ...lookup.summary, permalink: '' } : lookup.summary;
  return { ...lookup, core, intel, summary };
}

export function ttlFor(namespace: CacheNamespace, verdict: Verdict): number {
  if (verdict === 'error') return 0;
  if (verdict === 'unknown') return CACHE_RULES.unknownTtlMs;
  return namespace === 'file' ? CACHE_RULES.fileTtlMs : CACHE_RULES.urlTtlMs;
}

export class SmartCache {
  private indexQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly area: chrome.storage.StorageArea = chrome.storage.local,
    private readonly now: () => number = () => Date.now(),
    private readonly maxEntries: number = CACHE_RULES.maxEntries,
  ) {}

  async keyFor(namespace: CacheNamespace, target: string): Promise<string> {
    return `cache:${namespace}:${await sha256Hex(target)}`;
  }

  /** Returns the entry (fresh or not) or null when absent or past the offline-fallback window. */
  async get(namespace: CacheNamespace, target: string): Promise<CacheHit | null> {
    const key = await this.keyFor(namespace, target);
    const entry = (await this.area.get(key))[key] as CacheEntry | undefined;
    if (!entry) return null;
    const now = this.now();
    if (entry.expiresAt + CACHE_RULES.offlineFallbackMs <= now) return null;
    const fresh = entry.expiresAt > now && !ALWAYS_REFRESH.has(entry.verdict);
    return { entry, fresh };
  }

  async set(namespace: CacheNamespace, target: string, lookup: CachedLookup): Promise<boolean> {
    if (!CACHEABLE_STATUSES.has(lookup.status)) return false;
    const verdict = verdictFromVirusTotal(lookup.status, lookup.summary);
    const ttl = ttlFor(namespace, verdict);
    if (ttl <= 0) return false;

    const key = await this.keyFor(namespace, target);
    const now = this.now();
    const safe = sanitizeForCache(namespace, lookup);
    const entry: CacheEntry = {
      status: safe.status,
      summary: safe.summary,
      core: safe.core ?? null,
      intel: safe.intel ?? null,
      targetHash: key.slice(key.lastIndexOf(':') + 1),
      verdict,
      ratio: lookup.core?.ratio ?? null,
      analysisId: lookup.analysisId ?? null,
      storedAt: now,
      expiresAt: now + ttl,
    };
    await this.area.set({ [key]: entry });
    await this.updateIndex((index) => ({ ...index, [key]: now }));
    return true;
  }

  async invalidate(namespace: CacheNamespace, target: string): Promise<void> {
    const key = await this.keyFor(namespace, target);
    await this.area.remove(key);
    await this.updateIndex(({ [key]: _removed, ...rest }) => rest);
  }

  async size(): Promise<number> {
    return Object.keys(await this.readIndex()).length;
  }

  async clear(): Promise<number> {
    const keys = Object.keys(await this.readIndex());
    if (keys.length) await this.area.remove(keys);
    await this.area.set({ [INDEX_KEY]: {} });
    return keys.length;
  }

  private async readIndex(): Promise<CacheIndex> {
    return ((await this.area.get(INDEX_KEY))[INDEX_KEY] as CacheIndex | undefined) ?? {};
  }

  /** Serialized index updates; evicts the oldest and fully-expired entries. */
  private updateIndex(mutate: (index: CacheIndex) => CacheIndex): Promise<void> {
    const run = this.indexQueue.then(async () => {
      const oldestAllowed = this.now() - CACHE_RULES.fileTtlMs - CACHE_RULES.offlineFallbackMs;
      const next = mutate(await this.readIndex());
      const keys = Object.keys(next).sort((a, b) => next[b]! - next[a]!);
      const keep = keys.filter((key, position) => position < this.maxEntries && next[key]! > oldestAllowed);
      const kept = new Set(keep);
      const drop = keys.filter((key) => !kept.has(key));
      if (drop.length) await this.area.remove(drop);
      await this.area.set({ [INDEX_KEY]: Object.fromEntries(keep.map((key) => [key, next[key]!])) });
    });
    this.indexQueue = run.catch(() => undefined);
    return run;
  }
}
