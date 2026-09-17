import { analysisProgress } from '../../shared/components/AnalysisProgress';
import { bindErrorState, errorState } from '../../shared/components/ErrorState';
import { metadataGrid } from '../../shared/components/MetadataGrid';
import { bindPermalinks, fileReportHtml } from '../../shared/components/ReportViews';
import { mountScreenHeader } from '../../shared/components/ScreenHeader';
import { bindVendorTables } from '../../shared/components/VendorTable';
import { verdictChip } from '../../shared/components/VerdictChip';
import { escapeHtml, hydrateIcons, query } from '../../shared/dom';
import { icon, type IconName } from '../../shared/icons';
import { sendMessage } from '../../shared/messages';
import { ACTIVE_PHASES, type AnalysisJob, type FileMeta } from '../../shared/scan';
import { describeScanError, ScanError, type ScanErrorInfo } from '../../shared/scanErrors';
import { FILE_INPUT_ACCEPT, fileExtension, mimeTypeFor, validateFile } from '../../services/FileValidation';
import { sha256OfBlob } from '../../services/HashService';
import { indexedDbStaging, type UploadStaging } from '../../services/UploadStaging';
import { analysisJobStore } from '../../storage/AnalysisJobStore';
import { formatBytes } from '../../utils/format';
import { extractUrlsFromText } from '../../utils/url';
import { linksHtml } from '../AdvancedAnalysis/AdvancedAnalysis';
import { mountFooter } from '../Footer';
import type { Cleanup, ScreenContext } from '../router';
import template from './DocumentScanner.html?raw';
import './DocumentScanner.css';
import '../AdvancedAnalysis/AdvancedAnalysis.css';

/** Swappable for tests. */
export const uploadDeps: { staging: UploadStaging } = { staging: indexedDbStaging };

export const SCANNER_WINDOW_PATH = 'popup/index.html?mode=window';

export function isScannerWindow(): boolean {
  return new URLSearchParams(location.search).get('mode') === 'window';
}

/**
 * Where the native file chooser can open without losing the result.
 * On Windows and Linux, Chrome closes an extension's toolbar popup as soon as a
 * file dialog takes focus, so the chooser is opened from a small Webinel window
 * instead (same 440 × 600 interface, not a browser tab). macOS keeps the popup open.
 */
export async function filePickerMode(): Promise<'inline' | 'window'> {
  if (isScannerWindow()) return 'inline';
  try {
    const platform = await chrome.runtime.getPlatformInfo();
    return platform.os === 'mac' ? 'inline' : 'window';
  } catch {
    return 'window';
  }
}

/** Opens (or focuses) the scanner window, then closes the toolbar popup. */
export async function openScannerWindow(): Promise<void> {
  const base = chrome.runtime.getURL(SCANNER_WINDOW_PATH);
  const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
  const existing = tabs.find((tab) => tab.url?.startsWith(base));
  if (existing?.windowId !== undefined) {
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.windows.create({ url: `${base}#documents`, type: 'popup', width: 440, height: 600, focused: true });
  }
  window.close();
}

export function consentHtml(meta: FileMeta): string {
  return `<section class="consent glass" data-role="consent">
    <div class="consent__head">
      <span class="consent__icon">${icon('upload', 20)}</span>
      <h3 class="consent__title">VirusTotal has never seen this file</h3>
    </div>
    <p class="consent__text">Upload it so 70+ antivirus engines can analyze it? Uploaded files are shared with VirusTotal and its security partners and may be downloaded by them. <strong>Do not upload private or confidential documents.</strong></p>
    ${metadataGrid([
      { label: 'Filename', value: meta.fileName },
      { label: 'SHA-256', value: meta.sha256, mono: true },
      { label: 'File size', value: formatBytes(meta.size) },
    ])}
    <div class="consent__buttons">
      <button class="btn" type="button" data-action="decline-upload">Don't upload</button>
      <button class="btn btn--primary" type="button" data-action="approve-upload">${icon('upload', 13)}Upload to VirusTotal</button>
    </div>
  </section>`;
}

export function declinedHtml(meta: FileMeta): string {
  return `<section class="declined glass" data-role="declined">
    <div>${verdictChip('unknown')}</div>
    <p><strong>${escapeHtml(meta.fileName)}</strong> was not uploaded. VirusTotal has no record of this exact file, so Webinel cannot vouch for it — treat it with care.</p>
    <button class="btn" type="button" data-action="reconsider">Upload after all</button>
  </section>`;
}

export function fileJobHtml(job: AnalysisJob): string {
  if (ACTIVE_PHASES.has(job.phase)) return analysisProgress(job);
  if (job.phase === 'completed' && job.report) return fileReportHtml(job.report);
  return errorState(job.error ?? describeScanError('server-error'));
}

export async function mount(root: HTMLElement, ctx: ScreenContext): Promise<Cleanup> {
  root.innerHTML = template;
  hydrateIcons(root, (name, size) => icon(name as IconName, size));
  mountScreenHeader(root, 'Document Scanner', 'document', ctx.back);
  mountFooter(root, ctx.navigate);

  const dropzone = query(root, '[data-role="dropzone"]');
  const fileInput = query<HTMLInputElement>(root, '[data-role="file"]');
  const result = query(root, '[data-role="result"]');
  const linksPanel = query(root, '[data-role="links"]');
  fileInput.accept = FILE_INPUT_ACCEPT;
  const pickerMode = await filePickerMode();
  if (pickerMode === 'window') {
    query(root, '[data-role="picker-hint"]').hidden = false;
  }

  let jobId: string | null = null;
  let renderedKey = '';
  let pending: { meta: FileMeta; file: File } | null = null;

  const bindActions = () => {
    bindVendorTables(result);
    bindPermalinks(result);
    bindErrorState(result, { openSettings: () => ctx.navigate('settings'), retry: () => pending && void scan(pending.file) });
  };

  const showError = (error: ScanErrorInfo) => {
    jobId = null;
    result.innerHTML = errorState(error);
    bindActions();
  };

  const renderJob = (job: AnalysisJob | null, force = false) => {
    if (!job || job.id !== jobId) return;
    const key = ACTIVE_PHASES.has(job.phase) ? `${job.phase}:${job.polls}:${job.updatedAt}:${Math.floor(Date.now() / 1000)}` : `${job.id}:${job.phase}`;
    if (key === renderedKey && !force) return;
    renderedKey = key;
    result.innerHTML = fileJobHtml(job);
    bindActions();
  };

  const upload = async () => {
    if (!pending) return;
    const { meta, file } = pending;
    result.innerHTML = `<p class="documents__working">Preparing ${escapeHtml(meta.fileName)} for upload…</p>`;
    try {
      const stagingId = await uploadDeps.staging.put(file);
      const started = await sendMessage('file:upload', { meta, stagingId, consent: true });
      if (started.kind === 'job') {
        jobId = started.jobId;
        renderJob(await analysisJobStore.find(jobId), true);
      } else if (started.kind === 'error') {
        showError(started.error);
      }
    } catch {
      showError(describeScanError('server-error'));
    }
  };

  const showConsent = (meta: FileMeta) => {
    result.innerHTML = consentHtml(meta);
    query(result, '[data-action="approve-upload"]').addEventListener('click', () => void upload());
    query(result, '[data-action="decline-upload"]').addEventListener('click', () => {
      result.innerHTML = declinedHtml(meta);
      query(result, '[data-action="reconsider"]').addEventListener('click', () => showConsent(meta));
    });
  };

  const scanLinks = async (file: File) => {
    if (fileExtension(file.name) !== 'txt') return;
    const urls = extractUrlsFromText(await file.text());
    if (urls.length === 0) return;
    linksPanel.hidden = false;
    linksPanel.innerHTML = `<div class="empty-state"><span>Checking ${urls.length} links…</span></div>`;
    try {
      linksPanel.innerHTML = linksHtml(await sendMessage('scan:links', { urls }), 'Links in document');
    } catch {
      linksPanel.hidden = true;
    }
  };

  const scan = async (file: File) => {
    jobId = null;
    pending = null;
    linksPanel.hidden = true;
    try {
      validateFile({ fileName: file.name, size: file.size });
    } catch (error) {
      showError(error instanceof ScanError ? error.info : describeScanError('unsupported-file'));
      return;
    }
    result.innerHTML = `<p class="documents__working">Fingerprinting ${escapeHtml(file.name)} on this device…</p>`;
    try {
      const meta: FileMeta = {
        fileName: file.name,
        sha256: await sha256OfBlob(file),
        size: file.size,
        mimeType: mimeTypeFor(file.name, file.type),
      };
      pending = { meta, file };
      const outcome = await sendMessage('file:lookup', meta);
      if (outcome.kind === 'report') {
        result.innerHTML = `<p class="documents__known">${icon('check', 13)}VirusTotal already has this exact file, so no upload is needed.</p>${fileReportHtml(outcome.report)}`;
        bindActions();
      } else if (outcome.kind === 'needs-upload') {
        showConsent(meta);
      } else {
        showError(outcome.error);
      }
      await scanLinks(file);
    } catch {
      showError(describeScanError('server-error'));
    } finally {
      fileInput.value = '';
    }
  };

  // The dropzone is a <label> for the hidden file input: where it is safe, clicking
  // it opens the native file chooser right here. Otherwise use the scanner window.
  dropzone.addEventListener('click', (event) => {
    if (pickerMode === 'inline') return;
    event.preventDefault();
    void openScannerWindow();
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void scan(file);
  });
  dropzone.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (pickerMode === 'inline') fileInput.click();
    else void openScannerWindow();
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.dataset.dragging = 'true';
  });
  dropzone.addEventListener('dragleave', () => delete dropzone.dataset.dragging);
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    delete dropzone.dataset.dragging;
    const file = event.dataTransfer?.files[0];
    if (file) void scan(file);
  });
  result.addEventListener('click', async (event) => {
    const cancel = (event.target as Element).closest<HTMLButtonElement>('[data-action="cancel-analysis"]');
    if (!cancel?.dataset.job) return;
    cancel.disabled = true;
    await sendMessage('analysis:cancel', { jobId: cancel.dataset.job }).catch(() => undefined);
  });

  // Reopen onto an upload that is still running.
  const latest = await analysisJobStore.latest('file');
  if (latest && ACTIVE_PHASES.has(latest.phase)) {
    jobId = latest.id;
    renderJob(latest, true);
  }

  const unsubscribe = analysisJobStore.subscribe((jobs) => renderJob(jobId ? jobs[jobId] ?? null : null));
  const ticker = window.setInterval(async () => {
    if (!jobId) return;
    const job = await analysisJobStore.find(jobId);
    if (job && ACTIVE_PHASES.has(job.phase)) renderJob(job);
  }, 1000);
  return () => {
    unsubscribe();
    window.clearInterval(ticker);
  };
}
