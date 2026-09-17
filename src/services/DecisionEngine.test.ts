import { describe, expect, it } from 'vitest';
import type { HeuristicResult, VirusTotalLookupStatus, VirusTotalSummary } from '../shared/verdict';
import { actionFor, decide, verdictFromVirusTotal } from './DecisionEngine';

const clean: HeuristicResult = { score: 0, signals: [] };
const summary = (malicious: number, suspicious = 0, harmless = 60, undetected = 10): VirusTotalSummary => ({
  stats: { malicious, suspicious, harmless, undetected },
  reputation: 0,
  flaggedBy: [],
  lastAnalysisDate: null,
  permalink: '',
});

describe('DecisionEngine', () => {
  it('maps VirusTotal stats to verdicts', () => {
    expect(verdictFromVirusTotal('ok', summary(0))).toBe('safe');
    expect(verdictFromVirusTotal('ok', summary(1))).toBe('suspicious');
    expect(verdictFromVirusTotal('ok', summary(0, 2))).toBe('suspicious');
    expect(verdictFromVirusTotal('ok', summary(2))).toBe('dangerous');
    expect(verdictFromVirusTotal('ok', summary(0, 0, 0, 0))).toBe('unknown');
  });

  it('never reports Safe without positive VirusTotal evidence', () => {
    const statuses: VirusTotalLookupStatus[] = ['not-found', 'no-key', 'rate-limited', 'invalid-key', 'quota-exceeded', 'unreachable', 'error'];
    for (const status of statuses) {
      const { verdict, action } = decide({ heuristics: clean, virusTotalStatus: status, virusTotal: null, blockSuspicious: false });
      expect(verdict, status).not.toBe('safe');
      expect(['unknown', 'error']).toContain(verdict);
      expect(action).toBe('allow');
    }
  });

  it('lets heuristics escalate but never downgrade', () => {
    const risky: HeuristicResult = { score: 80, signals: [{ id: 'x', label: 'Looks fake', weight: 80 }] };
    expect(decide({ heuristics: risky, virusTotalStatus: 'ok', virusTotal: summary(0), blockSuspicious: false }).verdict).toBe('dangerous');
    expect(decide({ heuristics: clean, virusTotalStatus: 'ok', virusTotal: summary(5), blockSuspicious: false }).verdict).toBe('dangerous');
    expect(decide({ heuristics: { score: 45, signals: [] }, virusTotalStatus: 'no-key', virusTotal: null, blockSuspicious: false }).verdict).toBe('suspicious');
  });

  it('chooses actions from the verdict and user preference', () => {
    expect(actionFor('dangerous', false)).toBe('block');
    expect(actionFor('suspicious', false)).toBe('warn');
    expect(actionFor('suspicious', true)).toBe('block');
    expect(actionFor('unknown', true)).toBe('allow');
  });

  it('explains its decision with the strongest reasons first', () => {
    const heuristics: HeuristicResult = {
      score: 50,
      signals: [
        { id: 'a', label: 'weak', weight: 10 },
        { id: 'b', label: 'strong', weight: 40 },
      ],
    };
    const { reasons } = decide({ heuristics, virusTotalStatus: 'ok', virusTotal: summary(1), blockSuspicious: false });
    expect(reasons).toEqual(['Flagged by 1 security vendor on VirusTotal', 'strong', 'weak']);
  });
});
