import { describe, expect, it, vi } from 'vitest';
import { analysisProgress } from '../../src/shared/components/AnalysisProgress';
import { detectionCircle } from '../../src/shared/components/DetectionCircle';
import { bindErrorState, errorState } from '../../src/shared/components/ErrorState';
import { metadataGrid } from '../../src/shared/components/MetadataGrid';
import { bindPermalinks, fileReportHtml, fullUrlReportHtml, quickUrlReportHtml, redirectTimelineHtml } from '../../src/shared/components/ReportViews';
import { resultHeader } from '../../src/shared/components/ResultHeader';
import { bindVendorTables, vendorTable } from '../../src/shared/components/VendorTable';
import type { VendorResult } from '../../src/shared/scan';
import { describeScanError, type ScanErrorCode } from '../../src/shared/scanErrors';
import { vendorList } from '../integration/helpers';
import { chromeFake } from '../setup/chromeMock';
import { text } from '../setup/screen';
import { fileScanReport, job, urlReport } from '../fixtures/reports';

const html = (markup: string) => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.append(host);
  return host;
};

describe('DetectionCircle', () => {
  it('shows the ratio and an arc proportional to detections', () => {
    const host = html(detectionCircle({ detected: 5, total: 93 }, 'dangerous', 'complete'));
    expect(text(host)).toBe('5 / 93');
    const circle = host.querySelector('.detection-circle')!;
    expect(circle.getAttribute('data-tone')).toBe('danger');
    expect(circle.getAttribute('aria-label')).toBe('5 of 93 security vendors flagged this');
    const arc = Number(host.querySelector('.detection-circle__arc')!.getAttribute('stroke-dasharray')!.split(' ')[0]);
    expect(arc).toBeCloseTo((5 / 93) * 2 * Math.PI * 42, 1);
  });

  it('draws no arc for a clean result and keeps tiny detections visible', () => {
    const clean = html(detectionCircle({ detected: 0, total: 90 }, 'safe', 'complete'));
    expect(clean.querySelector('.detection-circle__arc')!.getAttribute('stroke-dasharray')!.startsWith('0.00 ')).toBe(true);
    const tiny = html(detectionCircle({ detected: 1, total: 95 }, 'suspicious', 'complete'));
    expect(Number(tiny.querySelector('.detection-circle__arc')!.getAttribute('stroke-dasharray')!.split(' ')[0])).toBeGreaterThanOrEqual(10);
  });

  it('describes in-progress states', () => {
    expect(html(detectionCircle({ detected: 0, total: 0 }, 'unknown', 'processing')).querySelector('[role="img"]')!.getAttribute('aria-label')).toContain('in progress');
    expect(html(detectionCircle({ detected: 1, total: 20 }, 'suspicious', 'partial')).querySelector('[role="img"]')!.getAttribute('aria-label')).toContain('so far');
  });
});

describe('VendorTable', () => {
  const vendors: VendorResult[] = [
    { engine: 'Alpha', verdict: 'malicious', category: 'malicious', label: 'Phishing' },
    { engine: 'Bravo', verdict: 'suspicious', category: 'suspicious', label: null },
    { engine: 'Charlie', verdict: 'clean', category: 'harmless', label: null },
    { engine: 'Delta', verdict: 'undetected', category: 'undetected', label: null },
    { engine: 'Echo', verdict: 'undetected', category: 'timeout', label: null },
  ];

  it('colours verdicts green / yellow / red / gray', () => {
    const host = html(vendorTable(vendors));
    const rows = [...host.querySelectorAll('tbody tr')].map((row) => [text(row.children[0]!), text(row.children[1]!), row.querySelector('.chip')!.className]);
    expect(rows).toEqual([
      ['Alpha', 'Phishing', 'chip chip--danger'],
      ['Bravo', 'Suspicious', 'chip chip--warn'],
      ['Charlie', 'Clean', 'chip chip--safe'],
      ['Delta', 'Undetected', 'chip chip--unknown'],
      ['Echo', 'Timeout', 'chip chip--unknown'],
    ]);
    expect([...host.querySelectorAll('.vendor-table__summary .chip')].map((chip) => text(chip))).toEqual(['1 Malicious', '1 Suspicious', '1 Clean', '2 Undetected']);
    expect([...host.querySelectorAll('thead th')].map((cell) => text(cell))).toEqual(['Antivirus', 'Verdict']);
  });

  it('collapses long tables and expands on demand', () => {
    const host = html(vendorTable(vendorList(2, 20), { limit: 5 }));
    bindVendorTables(host);
    bindVendorTables(host); // idempotent
    const hidden = () => host.querySelectorAll('tbody tr[hidden]').length;
    const toggle = host.querySelector<HTMLButtonElement>('[data-action="toggle-vendors"]')!;
    expect(hidden()).toBe(17);
    expect(text(toggle)).toBe('Show all 22 vendors');
    toggle.click();
    expect(hidden()).toBe(0);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(hidden()).toBe(17);
  });

  it('can show every vendor in a scrolling list', () => {
    const host = html(vendorTable(vendorList(4, 80), { scroll: true }));
    const scroller = host.querySelector<HTMLElement>('.vendor-table__scroll')!;
    expect(scroller).not.toBeNull();
    expect(scroller.getAttribute('aria-label')).toBe('All 84 antivirus vendors');
    expect(scroller.querySelectorAll('tbody tr')).toHaveLength(84);
    expect(host.querySelectorAll('tbody tr[hidden]')).toHaveLength(0);
    expect(host.querySelector('[data-action="toggle-vendors"]')).toBeNull();
    expect(text(host.querySelector('.vendor-table__count'))).toBe('84 vendors · scroll to see all');
  });

  it('has an empty state and escapes vendor data', () => {
    expect(text(html(vendorTable([])))).toBe('No antivirus results yet.');
    const host = html(vendorTable([{ engine: '<img src=x>', verdict: 'malicious', category: 'malicious', label: '<b>x</b>' }]));
    expect(host.querySelector('img, b')).toBeNull();
  });
});

describe('MetadataGrid and ResultHeader', () => {
  it('renders key/value rows with em dashes for missing values', () => {
    const host = html(metadataGrid([{ label: 'A', value: 'one' }, { label: 'B', value: null }, { label: 'C', value: 0 }]));
    expect([...host.querySelectorAll('.meta-grid__row')].map((row) => text(row))).toEqual(['A one', 'B —', 'C 0']);
    expect(host.querySelectorAll('.meta-grid__row').length).toBe(3);
    expect(html(metadataGrid([{ label: 'B', value: null }], { hideEmpty: true })).querySelectorAll('.meta-grid__row').length).toBe(0);
  });

  it('shows subject, verdict and state notices', () => {
    const partial = urlReport(0, { state: 'partial', verdict: 'unknown' });
    const host = html(resultHeader(partial, { title: 'evil.test', items: [{ label: 'URL', value: 'https://evil.test/' }] }));
    expect(text(host.querySelector('.result-header__title'))).toBe('evil.test');
    expect(text(host.querySelector('.chip'))).toBe('Unverified');
    expect(host.querySelector('[data-notice="state"]')).not.toBeNull();
    const stale = html(resultHeader(urlReport(3, { stale: true, source: 'cache' }), { title: 'x', items: [] }));
    expect(text(stale.querySelector('[data-notice="stale"]'))).toContain('not a fresh scan');
  });
});

describe('Result cards', () => {
  it('Scan Now card shows the quick metadata and vendors', () => {
    const host = html(quickUrlReportHtml(urlReport(3)));
    const labels = [...host.querySelectorAll('.meta-grid__label')].map((node) => text(node));
    expect(labels).toEqual(['URL', 'Domain', 'IP address', 'HTTP status', 'Content type', 'Last analysis']);
    expect(text(host.querySelector('.detection-circle'))).toBe('3 / 71');
    expect(host.querySelector('[data-section="vendors"] .vendor-table')).not.toBeNull();
    expect(host.querySelector('[data-section="dns"]')).toBeNull();
  });

  it('Advanced Analysis card has every required section', () => {
    const host = html(fullUrlReportHtml(urlReport(3)));
    expect([...host.querySelectorAll('[data-section]')].map((node) => node.getAttribute('data-section'))).toEqual([
      'threats',
      'reputation',
      'vendors',
      'categories',
      'redirects',
      'dns',
      'certificate',
      'whois',
    ]);
    expect([...host.querySelectorAll('.result-header .meta-grid__label')].map((node) => text(node))).toEqual([
      'URL', 'Domain', 'IP address', 'HTTP status', 'Content type', 'First seen', 'Last analysis',
    ]);
    expect(text(host.querySelector('[data-section="reputation"]'))).toContain('Community score -7');
    expect(text(host.querySelector('[data-section="reputation"]'))).toContain('2 harmless · 9 malicious');
    expect([...host.querySelectorAll('[data-section="categories"] .chip')].map((chip) => text(chip))).toEqual(['Phishing', 'Finance']);
    const dnsRows = [...host.querySelectorAll('[data-section="dns"] tbody tr')].map((row) => [...row.children].map((cell) => text(cell)));
    expect(dnsRows).toEqual([
      ['A', '203.0.113.9', '300'],
      ['MX', '10 mail.evil.test', '3600'],
    ]);
    expect(text(host.querySelector('[data-section="certificate"]'))).toContain("Let's Encrypt (R11)");
    expect(text(host.querySelector('[data-section="whois"]'))).toContain('Example Registrar');
    const raw = host.querySelector('details.raw-metadata')!;
    expect(raw.hasAttribute('open')).toBe(false);
    expect(raw.querySelector('script')).toBeNull();
    expect(host.querySelectorAll('.redirect-timeline__hop')).toHaveLength(3);
    // Advanced Analysis lists every vendor in a scrolling box.
    expect(host.querySelector('[data-section="vendors"] .vendor-table__scroll')).not.toBeNull();
    expect(host.querySelector('[data-section="vendors"] [data-action="toggle-vendors"]')).toBeNull();
  });

  it('shows friendly empty sections', () => {
    const bare = urlReport(0, { domain: null, threats: [], categories: [], votes: null, reputation: null, raw: null });
    const host = html(fullUrlReportHtml({ ...bare, url: { ...bare.url!, redirectChain: [] } }));
    expect(text(host.querySelector('[data-section="dns"]'))).toContain('No DNS records');
    expect(text(host.querySelector('[data-section="redirects"]'))).toContain('No redirects');
    expect(text(host.querySelector('[data-section="threats"]'))).toContain('No threat classification');
    expect(host.querySelector('details')).toBeNull();
    expect(redirectTimelineHtml(['https://a.test/'])).toContain('No redirects');
  });

  it('File card reuses the same components with file metadata', () => {
    const host = html(fileReportHtml(fileScanReport(2)));
    expect([...host.querySelectorAll('.meta-grid__label')].map((node) => text(node))).toEqual([
      'Filename', 'SHA-256', 'MIME type', 'File type', 'File size', 'Last analysis',
    ]);
    expect(text(host.querySelector('.meta-grid'))).toContain('2.0 KB');
    expect(host.querySelector('.detection-circle')).not.toBeNull();
    expect(host.querySelector('.vendor-table')).not.toBeNull();
  });

  it('opens VirusTotal permalinks only for virustotal.com', () => {
    const host = html(quickUrlReportHtml(urlReport(1)));
    bindPermalinks(host);
    host.querySelector<HTMLButtonElement>('[data-action="open-permalink"]')!.click();
    expect(chromeFake().tabs.create).toHaveBeenCalledWith({ url: 'https://www.virustotal.com/gui/x' });
    const evil = html('<button data-action="open-permalink" data-href="https://evil.test/">x</button>');
    bindPermalinks(evil);
    evil.querySelector('button')!.click();
    expect(chromeFake().tabs.create).toHaveBeenCalledTimes(1);
  });
});

describe('AnalysisProgress', () => {
  it('shows steps, elapsed time and a cancel button', () => {
    const host = html(analysisProgress(job({ report: urlReport(0, { state: 'partial' }) }), Date.now()));
    expect([...host.querySelectorAll('.analysis-progress__step')].map((step) => `${text(step)}:${step.getAttribute('data-state')}`)).toEqual([
      'Submitting URL:done',
      'Queued at VirusTotal:done',
      'Vendors analyzing:active',
      'Building full report:pending',
    ]);
    expect(text(host.querySelector('[data-role="elapsed"]'))).toMatch(/^Elapsed 1[12]s · 2 checks · 3 vendors reported$/);
    expect(host.querySelector('[data-action="cancel-analysis"]')!.getAttribute('data-job')).toBe('job-1');
  });

  it('labels the first step for file uploads', () => {
    const host = html(analysisProgress(job({ kind: 'file', phase: 'uploading', target: 'a.pdf', polls: 0 })));
    expect(text(host.querySelector('[data-state="active"]'))).toBe('Uploading file');
  });
});

describe('Error states', () => {
  it.each<[ScanErrorCode, string, string | null]>([
    ['missing-key', 'VirusTotal API key required.', 'Open Settings'],
    ['rate-limited', 'Daily API limit reached.', 'Try again'],
    ['offline', 'You appear to be offline.', 'Try again'],
    ['invalid-url', 'That is not a valid web address.', null],
    ['file-too-large', 'File is larger than 32 MB.', null],
  ])('%s', (code, title, action) => {
    const host = html(errorState(describeScanError(code)));
    expect(host.querySelector('[role="alert"]')!.getAttribute('data-error')).toBe(code);
    expect(text(host.querySelector('.error-state__title'))).toBe(title);
    expect(text(host.querySelector('[data-error-action]')) || null).toBe(action);
  });

  it('explains rate limits with retry guidance', () => {
    expect(describeScanError('rate-limited').message).toMatch(/4 requests per minute and 500 per day.*00:00 UTC/);
  });

  it('wires the call-to-action buttons', () => {
    const openSettings = vi.fn();
    const retry = vi.fn();
    const host = html(errorState(describeScanError('missing-key')) + errorState(describeScanError('offline')));
    bindErrorState(host, { openSettings, retry });
    host.querySelector<HTMLButtonElement>('[data-error-action="open-settings"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-error-action="retry"]')!.click();
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
