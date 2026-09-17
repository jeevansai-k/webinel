import { describe, expect, it } from 'vitest';
import { sampleCore, snapshot } from '../../tests/integration/helpers';
import { buildReport, coreFromAnalysis, reportVerdict, stateFromAnalysis, urlDetailsFor } from './ReportBuilder';

describe('ReportBuilder', () => {
  it('maps detections to verdicts', () => {
    expect(reportVerdict(sampleCore(0), 'complete')).toBe('safe');
    expect(reportVerdict(sampleCore(1), 'complete')).toBe('suspicious');
    expect(reportVerdict(sampleCore(4), 'complete')).toBe('dangerous');
  });

  it('never calls an unfinished or stale clean result Safe', () => {
    expect(reportVerdict(sampleCore(0), 'partial')).toBe('unknown');
    expect(reportVerdict(sampleCore(0), 'processing')).toBe('unknown');
    expect(reportVerdict(sampleCore(0), 'complete', true)).toBe('unknown');
    // …but detections are reported as soon as they appear.
    expect(reportVerdict(sampleCore(3), 'partial')).toBe('dangerous');
  });

  it('builds a report with domain IPs filled in', () => {
    const report = buildReport('url', sampleCore(0), {
      state: 'complete',
      analysisId: 'an',
      domain: { domain: 'example.com', ipAddresses: ['192.0.2.1'], dns: [], certificate: null, whois: [], categories: [], reputation: null },
      now: 5,
    });
    expect(report).toMatchObject({ kind: 'url', verdict: 'safe', analysisId: 'an', checkedAt: 5, source: 'virustotal', stale: false });
    expect(report.url?.ipAddresses).toEqual(['192.0.2.1']);
  });

  it('turns analysis snapshots into partial cores', () => {
    const running = snapshot('in-progress', 1, 4);
    const core = coreFromAnalysis(running, { url: urlDetailsFor('https://new.test/') });
    expect(core.ratio).toEqual({ detected: 1, total: 5 });
    expect(core.lastAnalysisDate).toBeNull();
    expect(core.url?.domain).toBe('new.test');
    expect(stateFromAnalysis(running)).toBe('partial');
    expect(stateFromAnalysis(snapshot('queued'))).toBe('processing');
    expect(stateFromAnalysis(null)).toBe('processing');
    expect(stateFromAnalysis(snapshot('completed'))).toBe('complete');
  });
});
