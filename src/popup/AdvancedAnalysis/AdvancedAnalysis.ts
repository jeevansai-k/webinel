import { analysisProgress } from '../../shared/components/AnalysisProgress';
import { bindErrorState, errorState } from '../../shared/components/ErrorState';
import { bindPermalinks, fullUrlReportHtml } from '../../shared/components/ReportViews';
import { mountScreenHeader } from '../../shared/components/ScreenHeader';
import { showToast } from '../../shared/components/Toast';
import { bindVendorTables, vendorTable } from '../../shared/components/VendorTable';
import { verdictChip, verdictText, verdictTone } from '../../shared/components/VerdictChip';
import { escapeHtml, hydrateIcons, query } from '../../shared/dom';
import { icon, type IconName } from '../../shared/icons';
import { sendMessage } from '../../shared/messages';
import { ACTIVE_PHASES, type AnalysisJob } from '../../shared/scan';
import { describeScanError, type ScanErrorInfo } from '../../shared/scanErrors';
import type { LinkScanSummary, RedirectHop, Verdict } from '../../shared/verdict';
import { extractLinksFromPage } from '../../services/LinkExtractor';
import { requireUrl } from '../../services/UrlValidation';
import { analysisJobStore } from '../../storage/AnalysisJobStore';
import { settingsStore } from '../../storage/SettingsStore';
import { extractUrlsFromText } from '../../utils/url';
import { getActiveTab } from '../activeTab';
import { mountFooter } from '../Footer';
import { takeHandoff } from '../handoff';
import type { Cleanup, ScreenContext } from '../router';
import template from './AdvancedAnalysis.html?raw';
import './AdvancedAnalysis.css';

/** Renders one analysis job: progress while running, the full report when done. */
export function jobHtml(job: AnalysisJob, now = Date.now()): string {
  if (ACTIVE_PHASES.has(job.phase)) {
    const partial = job.report?.vendors.length
      ? `<div class="analysis__partial"><h3 class="section-title">Vendors finished so far</h3><div class="report-section__body glass">${vendorTable(job.report.vendors, { scroll: true })}</div></div>`
      : '';
    return analysisProgress(job, now) + partial;
  }
  if (job.phase === 'completed' && job.report) return fullUrlReportHtml(job.report);
  return errorState(job.error ?? describeScanError('server-error'));
}

export function linksHtml(summary: LinkScanSummary, title: string): string {
  if (summary.total === 0) return `<div class="empty-state">${icon('mail', 20)}<span>No links found.</span></div>`;
  const order: Verdict[] = ['dangerous', 'suspicious', 'unknown', 'error', 'safe'];
  return `<div class="links__label"><span>${escapeHtml(title)}</span><span>${summary.total} link${summary.total === 1 ? '' : 's'}</span></div>
    <div class="links__summary">${order
      .filter((verdict) => summary.counts[verdict] > 0)
      .map((verdict) => `<span class="chip chip--${verdictTone(verdict)}">${summary.counts[verdict]} ${verdictText(verdict)}</span>`)
      .join('')}</div>
    <ul class="list">${summary.items
      .slice(0, 30)
      .map(
        (item) => `<li class="list-row">
          <div class="list-row__main">
            <div class="list-row__title">${escapeHtml(item.host)}</div>
            <div class="list-row__meta" title="${escapeHtml(item.url)}">${escapeHtml(item.reasons[0] ?? item.url)}</div>
          </div>
          ${verdictChip(item.verdict)}
        </li>`,
      )
      .join('')}</ul>`;
}

export function redirectsHtml(hops: RedirectHop[]): string {
  if (hops.length === 0) return `<div class="empty-state"><span>No redirects on the last page load.</span></div>`;
  const rows = hops.map(
    (hop) => `<div class="hop"><span class="hop__code">${hop.statusCode}</span><span class="hop__url" title="${escapeHtml(hop.from)}">${escapeHtml(hop.from)}</span></div>`,
  );
  const last = hops[hops.length - 1]!;
  rows.push(`<div class="hop"><span class="hop__code">END</span><span class="hop__url" title="${escapeHtml(last.to)}">${escapeHtml(last.to)}</span></div>`);
  const warning = hops.length >= 3 ? `<p class="redirects__warning">${hops.length} hops — long redirect chains are common in phishing.</p>` : '';
  return warning + rows.join('');
}

export async function mount(root: HTMLElement, ctx: ScreenContext): Promise<Cleanup> {
  root.innerHTML = template;
  hydrateIcons(root, (name, size) => icon(name as IconName, size));
  mountScreenHeader(root, 'Advanced Analysis', 'analysis', ctx.back);
  mountFooter(root, ctx.navigate);

  const form = query<HTMLFormElement>(root, '[data-role="form"]');
  const urlInput = query<HTMLInputElement>(root, '[data-role="url"]');
  const analyzeButton = query<HTMLButtonElement>(root, '[data-action="analyze"]');
  const jobPanel = query(root, '[data-role="job"]');
  const linksPanel = query(root, '[data-role="links"]');
  const tab = await getActiveTab().catch(() => null);

  let jobId: string | null = null;
  let renderedKey = '';

  const showError = (error: ScanErrorInfo) => {
    jobId = null;
    renderedKey = '';
    jobPanel.innerHTML = errorState(error);
    bindErrorState(jobPanel, { openSettings: () => ctx.navigate('settings'), retry: () => void analyze() });
  };

  const render = (job: AnalysisJob | null, force = false) => {
    if (!job || job.id !== jobId) return;
    const active = ACTIVE_PHASES.has(job.phase);
    analyzeButton.disabled = active;
    // Finished reports render once, so expanded tables and <details> keep their state.
    const key = active ? `${job.phase}:${job.polls}:${job.updatedAt}:${Math.floor(Date.now() / 1000)}` : `${job.id}:${job.phase}`;
    if (key === renderedKey && !force) return;
    renderedKey = key;
    // Keep the vendor list where the user scrolled it across live refreshes.
    const scrollTop = jobPanel.querySelector('.vendor-table__scroll')?.scrollTop ?? 0;
    jobPanel.innerHTML = jobHtml(job);
    const list = jobPanel.querySelector('.vendor-table__scroll');
    if (list) list.scrollTop = scrollTop;
    bindVendorTables(jobPanel);
    bindPermalinks(jobPanel);
    bindErrorState(jobPanel, { openSettings: () => ctx.navigate('settings'), retry: () => void analyze() });
  };

  const analyze = async () => {
    let url: string;
    try {
      url = requireUrl(urlInput.value);
    } catch {
      showError(describeScanError('invalid-url'));
      return;
    }
    urlInput.value = url;
    analyzeButton.disabled = true;
    try {
      const started = await sendMessage('analysis:start-url', { url });
      if (started.kind === 'job') {
        jobId = started.jobId;
        render(await analysisJobStore.find(jobId), true);
      } else if (started.kind === 'error') {
        showError(started.error);
      }
    } catch {
      showError(describeScanError('server-error'));
    } finally {
      if (!jobId) analyzeButton.disabled = false;
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void analyze();
  });

  // "Current site": analyze the page open in the active tab.
  const currentSite = query<HTMLButtonElement>(root, '[data-action="current-site"]');
  if (tab?.scannable && tab.host) {
    currentSite.disabled = false;
    currentSite.title = `Analyze ${tab.url}`;
    query(root, '[data-role="current-host"]').textContent = tab.host;
  } else {
    currentSite.title = 'Open a website in this tab to analyze it';
  }
  currentSite.addEventListener('click', () => {
    if (!tab?.scannable) return;
    urlInput.value = tab.url;
    void analyze();
  });

  jobPanel.addEventListener('click', async (event) => {
    const cancel = (event.target as Element).closest<HTMLButtonElement>('[data-action="cancel-analysis"]');
    if (!cancel?.dataset.job) return;
    cancel.disabled = true;
    await sendMessage('analysis:cancel', { jobId: cancel.dataset.job }).catch(() => undefined);
  });

  // Reopen onto the latest analysis, or start one handed over from Scan Now.
  const handoff = takeHandoff('advancedUrl');
  if (handoff) {
    urlInput.value = handoff.url;
    if (handoff.autostart) void analyze();
  } else {
    const latest = await analysisJobStore.latest('url');
    if (latest) {
      jobId = latest.id;
      urlInput.value = latest.target;
      render(latest, true);
    } else if (tab?.scannable) {
      urlInput.value = tab.url;
    }
  }

  const unsubscribe = analysisJobStore.subscribe((jobs) => render(jobId ? jobs[jobId] ?? null : null));
  const ticker = window.setInterval(async () => {
    if (!jobId) return;
    const job = await analysisJobStore.find(jobId);
    if (job && ACTIVE_PHASES.has(job.phase)) render(job);
  }, 1000);

  // ---- email & clipboard link scanners ----

  const showLinks = async (urls: string[], title: string) => {
    linksPanel.hidden = false;
    linksPanel.innerHTML = `<div class="empty-state"><span>Checking ${urls.length} link${urls.length === 1 ? '' : 's'}…</span></div>`;
    try {
      linksPanel.innerHTML = linksHtml(await sendMessage('scan:links', { urls }), title);
    } catch (error) {
      linksPanel.hidden = true;
      showToast(error instanceof Error ? error.message : 'Link scan failed', 'error');
    }
  };

  const settings = await settingsStore.get();
  const emailButton = query<HTMLButtonElement>(root, '[data-action="scan-email"]');
  const clipboardButton = query<HTMLButtonElement>(root, '[data-action="scan-clipboard"]');
  emailButton.title = settings.emailLinkScanner ? 'Check every link in the open email' : 'Enable Email Link Scanner in Settings';
  clipboardButton.title = settings.clipboardScanner ? 'Check links you copied' : 'Enable Clipboard Scanner in Settings';

  emailButton.addEventListener('click', async () => {
    if (!settings.emailLinkScanner) return showToast('Turn on Email Link Scanner in Settings first.', 'info');
    if (!tab?.scannable) return showToast('Open an email in this tab first.', 'info');
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractLinksFromPage });
      await showLinks((result?.result as string[] | undefined) ?? [], 'Email links');
    } catch {
      showToast('This page cannot be scanned.', 'error');
    }
  });

  clipboardButton.addEventListener('click', async () => {
    if (!settings.clipboardScanner) return showToast('Turn on Clipboard Scanner in Settings first.', 'info');
    try {
      // The clipboard text is read once, reduced to URLs, and discarded.
      const urls = extractUrlsFromText(await navigator.clipboard.readText());
      if (urls.length === 0) return showToast('No links found in the clipboard.', 'info');
      if (urls.length === 1) {
        urlInput.value = urls[0]!;
        return showToast('Link pasted — press Analyze for a full report.', 'info');
      }
      await showLinks(urls, 'Clipboard links');
    } catch {
      showToast('Clipboard access was denied.', 'error');
    }
  });

  const redirectsPanel = query(root, '[data-role="redirects"]');
  const hops = tab ? await sendMessage('tab:redirects', { tabId: tab.id }).catch(() => []) : [];
  redirectsPanel.innerHTML = redirectsHtml(hops);

  return () => {
    unsubscribe();
    window.clearInterval(ticker);
  };
}
