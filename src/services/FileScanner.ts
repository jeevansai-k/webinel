/**
 * File scanning workflow:
 *   validate locally → SHA-256 (done by the caller, on-device) → Smart Cache →
 *   VirusTotal hash lookup → if unknown, ask the user → upload → poll → report.
 * Nothing is ever uploaded without explicit consent.
 */
import { describeScanError, errorCodeForStatus, ScanError } from '../shared/scanErrors';
import type { FileDetails, FileMeta, ScanOutcome, ScanReport } from '../shared/scan';
import { mimeTypeFor, validateFile } from './FileValidation';
import { isSha256, sha256OfBlob } from './HashService';
import { buildReport, coreFromAnalysis } from './ReportBuilder';
import { pollAnalysis, systemClock, type FullScanProgress, type ScannerClock } from './UrlScanner';
import type { VirusTotalService } from './VirusTotalService';

export { fileExtension, validateFile } from './FileValidation';

function detailsFor(meta: FileMeta): FileDetails {
  return {
    fileName: meta.fileName,
    sha256: meta.sha256.toLowerCase(),
    mimeType: mimeTypeFor(meta.fileName, meta.mimeType),
    fileType: null,
    size: meta.size,
  };
}

function mergeDetails(core: ScanReport['file'], meta: FileMeta): FileDetails {
  const local = detailsFor(meta);
  // The user's own file name and size win; VirusTotal fills in type information.
  return { ...local, mimeType: core?.mimeType ?? local.mimeType, fileType: core?.fileType ?? local.fileType };
}

export interface UploadOptions {
  consent: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: FullScanProgress | { phase: 'uploading'; polls: 0; analysisId: null; partial: null }) => void | Promise<void>;
}

export class FileScanner {
  constructor(
    private readonly vt: VirusTotalService,
    private readonly clock: ScannerClock = systemClock,
  ) {}

  /** Hash lookup only. Returns `needs-upload` for files VirusTotal has never seen. */
  async lookup(meta: FileMeta): Promise<ScanOutcome> {
    try {
      validateFile(meta);
      if (!isSha256(meta.sha256)) throw new ScanError('server-error');
      const sha256 = meta.sha256.toLowerCase();
      const lookup = await this.vt.lookup('file', sha256, { fileName: meta.fileName });
      if (lookup.status === 'not-found') return { kind: 'needs-upload', sha256 };
      if (lookup.status !== 'ok' || !lookup.core) throw new ScanError(errorCodeForStatus(lookup.status));
      const core = { ...lookup.core, file: mergeDetails(lookup.core.file, meta) };
      return {
        kind: 'report',
        report: buildReport('file', core, {
          state: 'complete',
          analysisId: lookup.analysisId,
          source: lookup.fromCache ? 'cache' : 'virustotal',
          stale: lookup.stale,
          cachedAt: lookup.cachedAt,
          raw: lookup.raw,
          now: this.clock.now(),
        }),
      };
    } catch (error) {
      return { kind: 'error', error: error instanceof ScanError ? error.info : describeScanError('server-error') };
    }
  }

  /** Uploads with consent, then polls until VirusTotal finishes. */
  async upload(meta: FileMeta, file: Blob, options: UploadOptions): Promise<ScanReport> {
    if (options.consent !== true) throw new ScanError('consent-required');
    validateFile({ fileName: meta.fileName, size: file.size });
    const sha256 = meta.sha256.toLowerCase();
    // Integrity: the bytes we upload must be the file the user approved.
    if ((await sha256OfBlob(file)) !== sha256) throw new ScanError('server-error');

    const { signal } = options;
    await options.onProgress?.({ phase: 'uploading', polls: 0, analysisId: null, partial: null });
    const submission = await this.vt.uploadFile(file, meta.fileName, { wait: true, signal });
    signal?.throwIfAborted();
    if (submission.status !== 'ok' || !submission.analysisId) throw new ScanError(errorCodeForStatus(submission.status));
    const analysisId = submission.analysisId;

    const snapshot = await pollAnalysis(this.vt, this.clock, analysisId, { signal }, async (polls, current) => {
      const partial = buildReport('file', coreFromAnalysis(current, { file: detailsFor(meta) }), {
        state: current && current.vendors.length ? 'partial' : 'processing',
        analysisId,
      });
      await options.onProgress?.({ phase: current?.status === 'in-progress' ? 'in-progress' : 'queued', polls, analysisId, partial });
    });

    await options.onProgress?.({ phase: 'fetching-report', polls: 0, analysisId, partial: null });
    const object = await this.vt.lookup('file', sha256, { force: true, wait: true, signal, fileName: meta.fileName });
    signal?.throwIfAborted();
    const base = object.status === 'ok' && object.core ? object.core : coreFromAnalysis(snapshot, { file: detailsFor(meta) });
    const core = { ...base, file: mergeDetails(base.file, meta) };
    await this.vt.remember('file', sha256, core, analysisId);
    return buildReport('file', core, { state: 'complete', analysisId, raw: object.raw, now: this.clock.now() });
  }
}
