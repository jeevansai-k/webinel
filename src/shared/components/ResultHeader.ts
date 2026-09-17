import { escapeHtml } from '../dom';
import type { ScanReport } from '../scan';
import { detectionCircle } from './DetectionCircle';
import { metadataGrid, type MetadataItem } from './MetadataGrid';
import { verdictChip } from './VerdictChip';

const STATE_TEXT: Record<ScanReport['state'], string | null> = {
  complete: null,
  partial: 'Analysis still running — showing vendors that have finished',
  processing: 'Queued at VirusTotal — no vendor results yet',
};

export interface ResultHeaderOptions {
  title: string;
  subtitle?: string | null;
  items: MetadataItem[];
}

/** Detection circle + subject + status + key metadata. */
export function resultHeader(report: ScanReport, options: ResultHeaderOptions): string {
  const notices: string[] = [];
  const stateText = STATE_TEXT[report.state];
  if (stateText) notices.push(`<p class="result-header__notice" data-notice="state">${stateText}</p>`);
  if (report.stale) {
    notices.push('<p class="result-header__notice result-header__notice--warn" data-notice="stale">Offline — showing an older cached result. It is not a fresh scan.</p>');
  } else if (report.source === 'cache') {
    notices.push('<p class="result-header__notice" data-notice="cache">From Smart Cache</p>');
  }
  return `<header class="result-header glass" data-verdict="${report.verdict}">
    <div class="result-header__top">
      ${detectionCircle(report.ratio, report.verdict, report.state)}
      <div class="result-header__subject">
        <div class="result-header__chips">${verdictChip(report.verdict)}</div>
        <h2 class="result-header__title" title="${escapeHtml(options.title)}">${escapeHtml(options.title)}</h2>
        ${options.subtitle ? `<p class="result-header__subtitle mono" title="${escapeHtml(options.subtitle)}">${escapeHtml(options.subtitle)}</p>` : ''}
        <p class="result-header__caption">security vendors flagged this${report.state === 'complete' ? '' : ' so far'}</p>
      </div>
    </div>
    ${notices.join('')}
    ${metadataGrid(options.items)}
  </header>`;
}
