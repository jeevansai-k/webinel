/**
 * Runs long VirusTotal workflows (Advanced Analysis, consented file uploads)
 * in the background so the popup stays responsive and can close. Progress is
 * written to session storage; the popup subscribes to it. Jobs are cancellable.
 */
import { ACTIVE_PHASES, type AnalysisJob, type FileMeta, type ScanReport } from '../shared/scan';
import { describeScanError, ScanError, toScanErrorInfo } from '../shared/scanErrors';
import type { FileScanner } from '../services/FileScanner';
import { validateFile } from '../services/FileValidation';
import type { UploadStaging } from '../services/UploadStaging';
import type { FullScanProgress, UrlScanner } from '../services/UrlScanner';
import { requireUrl } from '../services/UrlValidation';
import { analysisJobStore } from '../storage/AnalysisJobStore';
import { statsStore } from '../storage/StatsStore';
import { timelineStore } from '../storage/TimelineStore';
import { getHost } from '../utils/url';

type Work = (signal: AbortSignal, progress: (update: FullScanProgress | { phase: 'uploading' }) => Promise<void>) => Promise<ScanReport>;

/** Firefox suspends an idle MV3 event page after ~30 s; any extension API call resets that timer. */
export const KEEPALIVE_INTERVAL_MS = 20_000;

export class AnalysisJobs {
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Map<string, Promise<void>>();
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly urls: UrlScanner,
    private readonly files: FileScanner,
    private readonly staging: UploadStaging,
  ) {}

  /** True while a keep-alive timer is holding the background page awake (test hook). */
  get keepingAlive(): boolean {
    return this.keepAlive !== null;
  }

  private updateKeepAlive(): void {
    if (this.controllers.size > 0 && !this.keepAlive) {
      this.keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo().catch(() => undefined), KEEPALIVE_INTERVAL_MS);
    } else if (this.controllers.size === 0 && this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }

  /** Jobs left active by a terminated worker cannot resume; mark them clearly. */
  async recoverInterrupted(): Promise<void> {
    const jobs = await analysisJobStore.get();
    for (const job of Object.values(jobs)) {
      if (ACTIVE_PHASES.has(job.phase) && !this.controllers.has(job.id)) {
        await analysisJobStore.patch(job.id, { phase: 'failed', error: describeScanError('interrupted') });
      }
    }
    await this.staging.clear().catch(() => undefined);
  }

  async startUrl(rawUrl: string): Promise<string> {
    const url = requireUrl(rawUrl);
    return this.start('url', url, (signal, progress) => this.urls.fullScan(url, { signal, onProgress: progress }), async (report) => {
      await statsStore.increment('fullAnalyses');
      await timelineStore.record({
        kind: 'full-analysis',
        subject: getHost(url) ?? url,
        verdict: report.verdict,
        detail: `${report.ratio.detected}/${report.ratio.total} vendors flagged it`,
      });
    });
  }

  async startFileUpload(meta: FileMeta, stagingId: string, consent: boolean): Promise<string> {
    if (consent !== true) {
      await this.staging.take(stagingId).catch(() => null);
      throw new ScanError('consent-required');
    }
    validateFile(meta);
    const blob = await this.staging.take(stagingId);
    if (!blob) throw new ScanError('upload-handoff');
    return this.start(
      'file',
      meta.fileName,
      (signal, progress) => this.files.upload(meta, blob, { consent, signal, onProgress: progress }),
      async (report) => {
        await statsStore.increment('filesUploaded');
        await timelineStore.record({
          kind: 'file-uploaded',
          subject: meta.fileName.slice(0, 80),
          verdict: report.verdict,
          detail: `Uploaded with your consent · ${report.ratio.detected}/${report.ratio.total} flagged`,
        });
      },
    );
  }

  async cancel(jobId: string): Promise<boolean> {
    const controller = this.controllers.get(jobId);
    if (!controller) return false;
    controller.abort();
    await this.running.get(jobId);
    return true;
  }

  /** Test hook: resolves when a job has settled. */
  settled(jobId: string): Promise<void> {
    return this.running.get(jobId) ?? Promise.resolve();
  }

  private async start(kind: AnalysisJob['kind'], target: string, work: Work, onComplete: (report: ScanReport) => Promise<void>): Promise<string> {
    const now = Date.now();
    const job: AnalysisJob = {
      id: crypto.randomUUID(),
      kind,
      target,
      phase: kind === 'file' ? 'uploading' : 'submitting',
      startedAt: now,
      updatedAt: now,
      polls: 0,
      analysisId: null,
      report: null,
      error: null,
    };
    await analysisJobStore.put(job);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.updateKeepAlive();

    const progress = async (update: FullScanProgress | { phase: 'uploading' }) => {
      if (controller.signal.aborted) return;
      const changes: Partial<AnalysisJob> = { phase: update.phase };
      if ('polls' in update) {
        if (update.polls) changes.polls = update.polls;
        if (update.analysisId) changes.analysisId = update.analysisId;
        if (update.partial) changes.report = update.partial;
      }
      await analysisJobStore.patch(job.id, changes);
    };

    const run = work(controller.signal, progress)
      .then(async (report) => {
        await analysisJobStore.patch(job.id, { phase: 'completed', report, error: null, analysisId: report.analysisId });
        await onComplete(report);
      })
      .catch(async (error: unknown) => {
        const cancelled = controller.signal.aborted;
        await analysisJobStore.patch(job.id, {
          phase: cancelled ? 'cancelled' : 'failed',
          error: cancelled ? describeScanError('cancelled') : toScanErrorInfo(error),
        });
      })
      .finally(() => {
        this.controllers.delete(job.id);
        this.running.delete(job.id);
        this.updateKeepAlive();
      });
    this.running.set(job.id, run);
    return job.id;
  }
}
