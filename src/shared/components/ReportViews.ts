/**
 * Report layouts built from the shared components. Scan Now, Advanced Analysis
 * and the Document Scanner all render through here, so their design language
 * stays identical.
 */
import { formatBytes, formatDate, formatDateTime } from '../../utils/format';
import { escapeHtml } from '../dom';
import { icon } from '../icons';
import type { ScanReport } from '../scan';
import { metadataGrid, type MetadataItem } from './MetadataGrid';
import { resultHeader } from './ResultHeader';
import { vendorTable } from './VendorTable';
import '../styles/report.css';

function section(title: string, body: string, id: string): string {
  return `<section class="report-section" data-section="${id}">
    <h3 class="section-title">${escapeHtml(title)}</h3>
    <div class="report-section__body glass">${body}</div>
  </section>`;
}

function emptyNote(text: string): string {
  return `<p class="report-section__empty">${escapeHtml(text)}</p>`;
}

function httpStatusText(status: number | null): string | null {
  return status === null ? null : String(status);
}

function urlItems(report: ScanReport, extended: boolean): MetadataItem[] {
  const url = report.url;
  const items: MetadataItem[] = [
    { label: 'URL', value: url?.url, mono: true },
    { label: 'Domain', value: url?.domain },
    { label: 'IP address', value: url?.ipAddresses.join(', ') || null, mono: true },
    { label: 'HTTP status', value: httpStatusText(url?.httpStatus ?? null) },
    { label: 'Content type', value: url?.contentType },
  ];
  if (extended) items.push({ label: 'First seen', value: formatDateTime(report.firstSeen) });
  items.push({ label: 'Last analysis', value: report.state === 'complete' ? formatDateTime(report.lastAnalysisDate) : 'In progress' });
  return items;
}

function viewOnVirusTotal(report: ScanReport): string {
  return report.permalink
    ? `<button class="btn" type="button" data-action="open-permalink" data-href="${escapeHtml(report.permalink)}">${icon('external', 13)}View on VirusTotal</button>`
    : '';
}

/** Scan Now: the quick decision view. */
export function quickUrlReportHtml(report: ScanReport): string {
  return `<div class="report" data-kind="url" data-state="${report.state}">
    ${resultHeader(report, { title: report.url?.domain ?? 'URL', subtitle: report.url?.title, items: urlItems(report, false) })}
    ${section('Antivirus vendors', vendorTable(report.vendors, { limit: 10 }), 'vendors')}
    <div class="report__actions">${viewOnVirusTotal(report)}</div>
  </div>`;
}

function reputationSection(report: ScanReport): string {
  const votes = report.votes;
  const items: MetadataItem[] = [
    { label: 'Community score', value: votes ? String(votes.harmless - votes.malicious) : null },
    { label: 'Reputation', value: report.reputation ?? report.domain?.reputation ?? null },
    { label: 'Votes', value: votes ? `${votes.harmless} harmless · ${votes.malicious} malicious` : null },
  ];
  return section('Community reputation', metadataGrid(items), 'reputation');
}

function chips(values: string[], tone: string, empty: string): string {
  if (values.length === 0) return emptyNote(empty);
  return `<div class="chip-list">${values.map((value) => `<span class="chip chip--${tone}">${escapeHtml(value)}</span>`).join('')}</div>`;
}

function dnsSection(report: ScanReport): string {
  const records = report.domain?.dns ?? [];
  const body = records.length
    ? `<table class="record-table"><thead><tr><th scope="col">Type</th><th scope="col">Value</th><th scope="col">TTL</th></tr></thead><tbody>${records
        .map((record) => `<tr><td>${escapeHtml(record.type)}</td><td class="mono">${escapeHtml(record.value)}</td><td>${record.ttl ?? '—'}</td></tr>`)
        .join('')}</tbody></table>`
    : emptyNote('No DNS records reported.');
  return section('DNS', body, 'dns');
}

function certificateSection(report: ScanReport): string {
  const cert = report.domain?.certificate;
  const body = cert
    ? metadataGrid([
        { label: 'Issuer', value: cert.issuer },
        { label: 'Subject', value: cert.subject },
        { label: 'Valid from', value: formatDate(cert.validFrom) },
        { label: 'Expiry', value: formatDate(cert.validTo) },
        { label: 'Fingerprint', value: cert.fingerprint, mono: true },
      ])
    : emptyNote('No HTTPS certificate on record.');
  return section('SSL certificate', body, 'certificate');
}

export function redirectTimelineHtml(chain: string[]): string {
  if (chain.length < 2) return emptyNote('No redirects — the URL loads directly.');
  return `<ol class="redirect-timeline">${chain
    .map(
      (hop, index) => `<li class="redirect-timeline__hop" data-final="${index === chain.length - 1}">
        <span class="redirect-timeline__node"></span>
        <span class="redirect-timeline__url mono" title="${escapeHtml(hop)}">${escapeHtml(hop)}</span>
      </li>`,
    )
    .join('')}</ol>`;
}

function whoisSection(report: ScanReport): string {
  const fields = report.domain?.whois ?? [];
  return section('WHOIS summary', fields.length ? metadataGrid(fields) : emptyNote('No public WHOIS details.'), 'whois');
}

function rawSection(report: ScanReport): string {
  if (!report.raw) return '';
  return `<details class="raw-metadata glass">
    <summary>Raw metadata</summary>
    <pre class="mono">${escapeHtml(report.raw)}</pre>
  </details>`;
}

/** Advanced Analysis: the complete report. */
export function fullUrlReportHtml(report: ScanReport): string {
  const categories = [...new Set([...report.categories, ...(report.domain?.categories ?? [])])];
  return `<div class="report report--full" data-kind="url" data-state="${report.state}">
    ${resultHeader(report, { title: report.url?.domain ?? 'URL', subtitle: report.url?.title, items: urlItems(report, true) })}
    ${section('Threat classification', chips(report.threats, 'danger', 'No threat classification — no vendor labelled a threat type.'), 'threats')}
    ${reputationSection(report)}
    ${section('Antivirus vendors', vendorTable(report.vendors, { scroll: true }), 'vendors')}
    ${section('Categories', chips(categories, 'accent', 'No categories reported.'), 'categories')}
    ${section('Redirect chain', redirectTimelineHtml(report.url?.redirectChain ?? []), 'redirects')}
    ${dnsSection(report)}
    ${certificateSection(report)}
    ${whoisSection(report)}
    ${rawSection(report)}
    <div class="report__actions">${viewOnVirusTotal(report)}</div>
  </div>`;
}

/** Document Scanner: same components, file metadata. */
export function fileReportHtml(report: ScanReport): string {
  const file = report.file;
  const items: MetadataItem[] = [
    { label: 'Filename', value: file?.fileName },
    { label: 'SHA-256', value: file?.sha256, mono: true },
    { label: 'MIME type', value: file?.mimeType, mono: true },
    { label: 'File type', value: file?.fileType },
    { label: 'File size', value: formatBytes(file?.size ?? null) },
    { label: 'Last analysis', value: report.state === 'complete' ? formatDateTime(report.lastAnalysisDate) : 'In progress' },
  ];
  return `<div class="report" data-kind="file" data-state="${report.state}">
    ${resultHeader(report, { title: file?.fileName ?? 'File', items })}
    ${report.threats.length ? section('Threat classification', chips(report.threats, 'danger', ''), 'threats') : ''}
    ${section('Antivirus vendors', vendorTable(report.vendors, { limit: 10 }), 'vendors')}
    ${rawSection(report)}
    <div class="report__actions">${viewOnVirusTotal(report)}</div>
  </div>`;
}

/** Opens "View on VirusTotal" buttons in a new tab. */
export function bindPermalinks(root: ParentNode): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action="open-permalink"]:not([data-bound])')) {
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      const href = button.dataset.href ?? '';
      if (href.startsWith('https://www.virustotal.com/')) void chrome.tabs.create({ url: href });
    });
  }
}
