/**
 * Assembles ScanReports from VirusTotal objects, analysis snapshots and cache
 * entries. Pure functions — no I/O.
 */
import { detectionRatio } from '../api/parsers';
import type { AnalysisSnapshot } from '../api/parsers';
import type { DomainIntel, FileDetails, ReportState, ScanCore, ScanReport, UrlDetails } from '../shared/scan';
import type { Verdict } from '../shared/verdict';
import { getHost } from '../utils/url';
import { verdictFromVirusTotal } from './DecisionEngine';

export interface ReportContext {
  state: ReportState;
  analysisId?: string | null;
  domain?: DomainIntel | null;
  source?: 'virustotal' | 'cache';
  stale?: boolean;
  cachedAt?: number | null;
  raw?: string | null;
  now?: number;
}

/**
 * Verdict for a report. An unfinished analysis with no detections is Unknown —
 * "nothing flagged yet" is never presented as Safe.
 */
export function reportVerdict(core: Pick<ScanCore, 'stats'>, state: ReportState, stale = false): Verdict {
  const verdict = verdictFromVirusTotal('ok', { stats: core.stats, reputation: 0, flaggedBy: [], lastAnalysisDate: null, permalink: '' });
  if (verdict === 'safe' && (state !== 'complete' || stale)) return 'unknown';
  return verdict;
}

export function buildReport(kind: 'url' | 'file', core: ScanCore, context: ReportContext): ScanReport {
  const domain = context.domain ?? null;
  const url = core.url && domain && core.url.ipAddresses.length === 0 ? { ...core.url, ipAddresses: domain.ipAddresses } : core.url;
  return {
    ...core,
    url,
    kind,
    verdict: reportVerdict(core, context.state, context.stale),
    state: context.state,
    analysisId: context.analysisId ?? null,
    domain,
    source: context.source ?? 'virustotal',
    stale: context.stale ?? false,
    cachedAt: context.cachedAt ?? null,
    checkedAt: context.now ?? Date.now(),
    raw: context.raw ?? null,
  };
}

function emptyCore(): ScanCore {
  const stats = { malicious: 0, suspicious: 0, harmless: 0, undetected: 0 };
  return {
    stats,
    vendors: [],
    ratio: detectionRatio(stats),
    reputation: null,
    votes: null,
    firstSeen: null,
    lastAnalysisDate: null,
    permalink: null,
    categories: [],
    threats: [],
    url: null,
    file: null,
  };
}

export function urlDetailsFor(url: string): UrlDetails {
  return { url, finalUrl: null, domain: getHost(url) ?? '', title: null, httpStatus: null, contentType: null, ipAddresses: [], redirectChain: [] };
}

/** A core built only from an analysis snapshot (used while VirusTotal is still working). */
export function coreFromAnalysis(
  snapshot: AnalysisSnapshot | null,
  subject: { url?: UrlDetails; file?: FileDetails },
): ScanCore {
  const core = emptyCore();
  if (snapshot) {
    core.stats = snapshot.stats;
    core.vendors = snapshot.vendors.filter((vendor) => vendor.category !== 'type-unsupported');
    core.ratio = detectionRatio(snapshot.stats);
    core.lastAnalysisDate = snapshot.status === 'completed' ? snapshot.date : null;
  }
  core.url = subject.url ?? null;
  core.file = subject.file ?? null;
  if (subject.file) core.permalink = `https://www.virustotal.com/gui/file/${subject.file.sha256}`;
  return core;
}

export function stateFromAnalysis(snapshot: AnalysisSnapshot | null): ReportState {
  if (snapshot?.status === 'completed') return 'complete';
  return snapshot && snapshot.vendors.length > 0 ? 'partial' : 'processing';
}
