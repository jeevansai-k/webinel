import { DAY, HOUR, MINUTE } from '../utils/time';
import type { Verdict } from './verdict';

export const PRODUCT_NAME = 'Webinel';
export const PRODUCT_TAGLINE = 'Your Web Sentinel';

export const VIRUSTOTAL = {
  baseUrl: 'https://www.virustotal.com/api/v3',
  guiUrl: 'https://www.virustotal.com/gui',
  /** Public API allowance. */
  requestsPerWindow: 4,
  windowMs: MINUTE,
  timeoutMs: 15_000,
  /** Domain probed by the API health checker. */
  healthProbeDomain: 'virustotal.com',
} as const;

/**
 * Smart Cache rules:
 * - URLs (and domains) are trusted for 24 h, files for 7 days.
 * - Dangerous results are re-checked on every lookup (the cached copy is only a fallback).
 * - Unknown results are kept briefly, never long-term.
 * - Failures are never cached.
 */
export const CACHE_RULES = {
  urlTtlMs: 24 * HOUR,
  fileTtlMs: 7 * DAY,
  unknownTtlMs: 1 * HOUR,
  /** Expired entries are kept this long only as a clearly-labelled offline fallback. */
  offlineFallbackMs: 30 * DAY,
  maxEntries: 500,
} as const;

/** Verdicts whose cached copy must be refreshed on every lookup. */
export const ALWAYS_REFRESH: ReadonlySet<Verdict> = new Set(['dangerous']);

export const SCANNING = {
  /** Scan Now stops waiting for vendors after this long. */
  quickScanDeadlineMs: 6_000,
  quickScanPollMs: 2_000,
  /** Advanced Analysis polling: no overall timeout, cancellable. */
  fullAnalysisFirstPollMs: 5_000,
  fullAnalysisPollMs: 15_000,
  /** VirusTotal may briefly answer 404 for a fresh analysis id. */
  analysisNotFoundRetries: 4,
  maxJobs: 10,
} as const;

export const MAX_FILE_BYTES = 32 * 1024 * 1024;

/** Document Scanner accepts exactly these types. */
export const SUPPORTED_FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  exe: 'application/vnd.microsoft.portable-executable',
  apk: 'application/vnd.android.package-archive',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  txt: 'text/plain',
};

export const DECISION_THRESHOLDS = {
  vtMaliciousDangerous: 2,
  heuristicSuspicious: 40,
  heuristicDangerous: 75,
} as const;

export const LIMITS = {
  timelineEntries: 500,
  activityEntries: 20,
  linksPerScan: 100,
  statsDays: 7,
  redirectHops: 20,
  temporaryBypassMs: 30 * MINUTE,
  statsRetentionMs: 30 * DAY,
} as const;

export const CONTINUE_GATE_DURATION_MS = 3_000;

/** Where "Contact Developer" in Settings sends people. */
export const DEVELOPER = {
  email: 'kukkalajeevansai@gmail.com',
  github: 'https://github.com/jeevansai-k',
} as const;

/** A mailto: link that opens the user's email app with a pre-filled subject. */
export function developerMailto(version: string): string {
  return `mailto:${DEVELOPER.email}?subject=${encodeURIComponent(`Webinel ${version} — feedback`)}`;
}
