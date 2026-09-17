/**
 * URL scanning workflows.
 *
 * quickScan  — "Scan Now": cache → lookup → (unknown URL) submit and collect
 *              vendor results for at most 6 seconds, then stop and report.
 * fullScan   — "Advanced Analysis": submit → poll until VirusTotal completes
 *              (no timeout, cancellable) → full report with domain intel.
 */
import type { AnalysisSnapshot } from '../api/parsers';
import { SCANNING } from '../shared/config';
import { describeScanError, errorCodeForStatus, ScanError } from '../shared/scanErrors';
import type { ScanOutcome, ScanReport } from '../shared/scan';
import { getHost } from '../utils/url';
import { defaultSleep } from './RateLimiter';
import { requireUrl } from './UrlValidation';
import { buildReport, coreFromAnalysis, stateFromAnalysis, urlDetailsFor } from './ReportBuilder';
import type { LookupOutcome, VirusTotalService } from './VirusTotalService';

export interface ScannerClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: ScannerClock = { now: () => Date.now(), sleep: defaultSleep };

export interface FullScanProgress {
  phase: 'submitting' | 'queued' | 'in-progress' | 'fetching-report';
  polls: number;
  analysisId: string | null;
  partial: ScanReport | null;
}

export interface FullScanOptions {
  signal?: AbortSignal;
  onProgress?: (progress: FullScanProgress) => void | Promise<void>;
}

export { requireUrl } from './UrlValidation';

function throwForStatus(lookup: Pick<LookupOutcome, 'status'>): never {
  throw new ScanError(errorCodeForStatus(lookup.status));
}

export class UrlScanner {
  constructor(
    private readonly vt: VirusTotalService,
    private readonly clock: ScannerClock = systemClock,
  ) {}

  async quickScan(rawUrl: string): Promise<ScanOutcome> {
    try {
      return { kind: 'report', report: await this.runQuickScan(rawUrl) };
    } catch (error) {
      if (error instanceof ScanError) return { kind: 'error', error: error.info };
      return { kind: 'error', error: describeScanError('server-error') };
    }
  }

  private async runQuickScan(rawUrl: string): Promise<ScanReport> {
    const url = requireUrl(rawUrl);
    const host = getHost(url)!;
    const deadline = this.clock.now() + SCANNING.quickScanDeadlineMs;
    // Hard stop: anything still in flight when the window closes is aborted.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCANNING.quickScanDeadlineMs);
    const timedOut = () => controller.signal.aborted || this.clock.now() >= deadline;
    const options = { deadline, signal: controller.signal };
    try {
      const intel = (await this.vt.peek('domain', host))?.intel ?? null;

      const lookup = await this.vt.lookup('url', url, options);
      if (lookup.status === 'ok' && lookup.core) {
        return buildReport('url', lookup.core, {
          state: 'complete',
          analysisId: lookup.analysisId,
          domain: intel,
          source: lookup.fromCache ? 'cache' : 'virustotal',
          stale: lookup.stale,
          cachedAt: lookup.cachedAt,
          now: this.clock.now(),
        });
      }
      if (timedOut()) throw new ScanError('timeout');
      if (lookup.status !== 'not-found') throwForStatus(lookup);

      // Unknown URL: submit it and collect whatever vendors finish before the deadline.
      const submission = await this.vt.submitUrl(url, options);
      if (timedOut() && submission.status !== 'ok') throw new ScanError('timeout');
      if (submission.status !== 'ok' || !submission.analysisId) throwForStatus(submission);

      let snapshot: AnalysisSnapshot | null = null;
      while (snapshot?.status !== 'completed') {
        if (deadline - this.clock.now() < SCANNING.quickScanPollMs) break;
        await this.clock.sleep(SCANNING.quickScanPollMs, controller.signal).catch(() => undefined);
        if (timedOut()) break;
        const polled = await this.vt.getAnalysis(submission.analysisId, options);
        if (timedOut()) break; // never wait past the deadline, even for a slow response
        if (polled.status === 'ok' && polled.analysis) snapshot = polled.analysis;
        else if (polled.status !== 'not-found') break;
      }

      const state = stateFromAnalysis(snapshot);
      const core = coreFromAnalysis(snapshot, { url: urlDetailsFor(url) });
      if (state === 'complete') await this.vt.remember('url', url, core, submission.analysisId);
      return buildReport('url', core, { state, analysisId: submission.analysisId, domain: intel, now: this.clock.now() });
    } finally {
      clearTimeout(timer);
      controller.abort(); // nothing may outlive the 6-second window
    }
  }

  async fullScan(rawUrl: string, options: FullScanOptions = {}): Promise<ScanReport> {
    const url = requireUrl(rawUrl);
    const host = getHost(url)!;
    const { signal } = options;
    const progress = (update: FullScanProgress) => options.onProgress?.(update);

    await progress({ phase: 'submitting', polls: 0, analysisId: null, partial: null });
    const submission = await this.vt.submitUrl(url, { wait: true, signal });
    signal?.throwIfAborted();
    if (submission.status !== 'ok' || !submission.analysisId) throwForStatus(submission);
    const analysisId = submission.analysisId;

    const snapshot = await pollAnalysis(this.vt, this.clock, analysisId, { signal }, async (polls, current) => {
      const partial = buildReport('url', coreFromAnalysis(current, { url: urlDetailsFor(url) }), {
        state: stateFromAnalysis(current),
        analysisId,
      });
      await progress({ phase: current?.status === 'in-progress' ? 'in-progress' : 'queued', polls, analysisId, partial });
    });

    await progress({ phase: 'fetching-report', polls: 0, analysisId, partial: null });
    const [object, domain] = await Promise.all([
      this.vt.lookup('url', url, { force: true, wait: true, signal }),
      // Fresh domain intel: the cache deliberately keeps no DNS/WHOIS/certificate details.
      this.vt.lookup('domain', host, { force: true, wait: true, signal }),
    ]);
    signal?.throwIfAborted();
    const intel = domain.intel ?? null;

    // Prefer the full URL object; fall back to the finished analysis if VirusTotal has not indexed it yet.
    const core = object.status === 'ok' && object.core ? object.core : coreFromAnalysis(snapshot, { url: urlDetailsFor(url) });
    await this.vt.remember('url', url, core, analysisId);
    return buildReport('url', core, { state: 'complete', analysisId, domain: intel, raw: object.raw, now: this.clock.now() });
  }
}

/** Shared polling loop for URL and file analyses. No overall timeout; honours `signal`. */
export async function pollAnalysis(
  vt: VirusTotalService,
  clock: ScannerClock,
  analysisId: string,
  options: { signal?: AbortSignal },
  onPoll: (polls: number, snapshot: AnalysisSnapshot | null) => Promise<void>,
): Promise<AnalysisSnapshot> {
  const { signal } = options;
  let polls = 0;
  let notFound = 0;
  let snapshot: AnalysisSnapshot | null = null;
  await onPoll(polls, snapshot);
  for (;;) {
    await clock.sleep(polls === 0 ? SCANNING.fullAnalysisFirstPollMs : SCANNING.fullAnalysisPollMs, signal);
    const result = await vt.getAnalysis(analysisId, { wait: true, signal });
    signal?.throwIfAborted();
    polls += 1;
    if (result.status === 'ok' && result.analysis) {
      snapshot = result.analysis;
      await onPoll(polls, snapshot);
      if (snapshot.status === 'completed') return snapshot;
      continue;
    }
    if (result.status === 'not-found' && ++notFound <= SCANNING.analysisNotFoundRetries) continue;
    throw new ScanError(errorCodeForStatus(result.status));
  }
}
