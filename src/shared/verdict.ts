/** Core threat-model types shared by the background, popup and warning page. */

export type Verdict = 'safe' | 'suspicious' | 'dangerous' | 'unknown' | 'error';

export type ProtectionAction = 'allow' | 'warn' | 'block';

export type ScanScope = 'domain' | 'url';

export type VerdictSource = 'whitelist' | 'cache' | 'virustotal' | 'heuristics';

export type VirusTotalLookupStatus =
  | 'ok'
  | 'not-found'
  | 'no-key'
  | 'rate-limited'
  | 'invalid-key'
  | 'forbidden'
  | 'quota-exceeded'
  | 'unreachable'
  | 'error';

export interface VirusTotalStats {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
}

export interface VirusTotalSummary {
  stats: VirusTotalStats;
  reputation: number;
  /** Engine names that flagged the resource, capped for display. */
  flaggedBy: string[];
  lastAnalysisDate: number | null;
  permalink: string;
}

export interface HeuristicSignal {
  id: string;
  label: string;
  weight: number;
}

export interface HeuristicResult {
  score: number;
  signals: HeuristicSignal[];
}

export interface ThreatReport {
  /** Normalized URL (scope "url") or host (scope "domain"). */
  target: string;
  host: string;
  scope: ScanScope;
  verdict: Verdict;
  action: ProtectionAction;
  source: VerdictSource;
  heuristics: HeuristicResult;
  virusTotalStatus: VirusTotalLookupStatus;
  virusTotal: VirusTotalSummary | null;
  reasons: string[];
  checkedAt: number;
}

export interface LinkScanItem {
  url: string;
  host: string;
  verdict: Verdict;
  reasons: string[];
}

export interface LinkScanSummary {
  total: number;
  counts: Record<Verdict, number>;
  items: LinkScanItem[];
}

export interface RedirectHop {
  from: string;
  to: string;
  statusCode: number;
  timestamp: number;
}

export type ApiHealthState = 'online' | 'no-key' | 'invalid-key' | 'quota-exceeded' | 'unreachable';

export interface ApiHealth {
  state: ApiHealthState;
  checkedAt: number;
  latencyMs: number | null;
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  safe: 'Safe',
  suspicious: 'Suspicious',
  dangerous: 'Dangerous',
  unknown: 'Unknown',
  error: 'Error',
};

export function emptyVerdictCounts(): Record<Verdict, number> {
  return { safe: 0, suspicious: 0, dangerous: 0, unknown: 0, error: 0 };
}
