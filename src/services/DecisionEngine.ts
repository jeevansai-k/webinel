/**
 * Merges VirusTotal evidence and heuristics into a verdict and an action.
 * Invariant: `safe` requires a positive VirusTotal result — missing data is
 * `unknown` (or `error`), never `safe`.
 */
import { DECISION_THRESHOLDS } from '../shared/config';
import type {
  HeuristicResult,
  ProtectionAction,
  Verdict,
  VirusTotalLookupStatus,
  VirusTotalSummary,
} from '../shared/verdict';

export interface DecisionInput {
  heuristics: HeuristicResult;
  virusTotalStatus: VirusTotalLookupStatus;
  virusTotal: VirusTotalSummary | null;
  blockSuspicious: boolean;
}

export interface Decision {
  verdict: Verdict;
  action: ProtectionAction;
  reasons: string[];
}

const SEVERITY: Record<Verdict, number> = { safe: 0, unknown: 1, error: 1, suspicious: 2, dangerous: 3 };

export function verdictFromVirusTotal(status: VirusTotalLookupStatus, summary: VirusTotalSummary | null): Verdict {
  if (status === 'not-found') return 'unknown';
  if (status !== 'ok' || !summary) return status === 'no-key' ? 'unknown' : 'error';
  const { malicious, suspicious, harmless, undetected } = summary.stats;
  if (malicious >= DECISION_THRESHOLDS.vtMaliciousDangerous) return 'dangerous';
  if (malicious >= 1 || suspicious >= 1) return 'suspicious';
  if (harmless + undetected > 0) return 'safe';
  return 'unknown';
}

export function verdictFromHeuristics(heuristics: HeuristicResult): Verdict | null {
  if (heuristics.score >= DECISION_THRESHOLDS.heuristicDangerous) return 'dangerous';
  if (heuristics.score >= DECISION_THRESHOLDS.heuristicSuspicious) return 'suspicious';
  return null;
}

export function actionFor(verdict: Verdict, blockSuspicious: boolean): ProtectionAction {
  if (verdict === 'dangerous') return 'block';
  if (verdict === 'suspicious') return blockSuspicious ? 'block' : 'warn';
  return 'allow';
}

function virusTotalReason(status: VirusTotalLookupStatus, summary: VirusTotalSummary | null): string | null {
  switch (status) {
    case 'ok': {
      const flagged = (summary?.stats.malicious ?? 0) + (summary?.stats.suspicious ?? 0);
      return flagged > 0
        ? `Flagged by ${flagged} security vendor${flagged === 1 ? '' : 's'} on VirusTotal`
        : 'No security vendor flagged this on VirusTotal';
    }
    case 'not-found':
      return 'VirusTotal has no record of this yet';
    case 'no-key':
      return 'Add a VirusTotal API key for reputation checks';
    case 'rate-limited':
      return 'VirusTotal check deferred to respect API limits';
    case 'invalid-key':
      return 'VirusTotal rejected the API key';
    case 'quota-exceeded':
      return 'VirusTotal API quota exceeded';
    case 'unreachable':
      return 'VirusTotal could not be reached';
    default:
      return 'VirusTotal check failed';
  }
}

export function decide(input: DecisionInput): Decision {
  const vtVerdict = verdictFromVirusTotal(input.virusTotalStatus, input.virusTotal);
  const heuristicVerdict = verdictFromHeuristics(input.heuristics);

  let verdict = vtVerdict;
  if (heuristicVerdict && SEVERITY[heuristicVerdict] > SEVERITY[verdict]) verdict = heuristicVerdict;

  const reasons = input.heuristics.signals
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((signal) => signal.label);
  const vtReason = virusTotalReason(input.virusTotalStatus, input.virusTotal);
  if (vtReason) reasons.unshift(vtReason);

  return { verdict, action: actionFor(verdict, input.blockSuspicious), reasons };
}
