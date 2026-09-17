import { bindErrorState, errorState } from '../../../shared/components/ErrorState';
import { bindPermalinks, quickUrlReportHtml } from '../../../shared/components/ReportViews';
import { mountScreenHeader } from '../../../shared/components/ScreenHeader';
import { bindVendorTables } from '../../../shared/components/VendorTable';
import { SCANNING } from '../../../shared/config';
import { escapeHtml, hydrateIcons, query } from '../../../shared/dom';
import { icon, type IconName } from '../../../shared/icons';
import { sendMessage } from '../../../shared/messages';
import type { ScanOutcome } from '../../../shared/scan';
import { describeScanError } from '../../../shared/scanErrors';
import { requireUrl } from '../../../services/UrlValidation';
import { getActiveTab } from '../../activeTab';
import { mountFooter } from '../../Footer';
import { handOff, takeHandoff } from '../../handoff';
import type { ScreenContext } from '../../router';
import template from './ScanNow.html?raw';
import './ScanNow.css';

export function renderOutcome(container: HTMLElement, outcome: ScanOutcome): void {
  if (outcome.kind === 'report') {
    container.innerHTML = quickUrlReportHtml(outcome.report);
    bindVendorTables(container);
    bindPermalinks(container);
    return;
  }
  const error = outcome.kind === 'error' ? outcome.error : describeScanError('server-error');
  container.innerHTML = errorState(error);
}

/** Scan Now — the fast (~6 s) VirusTotal check launched from Home. */
export async function mount(root: HTMLElement, ctx: ScreenContext): Promise<void> {
  root.innerHTML = template;
  hydrateIcons(root, (name, size) => icon(name as IconName, size));
  mountScreenHeader(root, 'Scan Now', 'search', ctx.back);
  mountFooter(root, ctx.navigate);

  const form = query<HTMLFormElement>(root, '[data-role="form"]');
  const input = query<HTMLInputElement>(root, '[data-role="url"]');
  const button = query<HTMLButtonElement>(root, '[data-action="scan"]');
  const timer = query(root, '[data-role="timer"]');
  const result = query(root, '[data-role="result"]');
  const fullAnalysis = query<HTMLButtonElement>(root, '[data-action="full-analysis"]');

  const scan = async () => {
    fullAnalysis.hidden = true;
    let url: string;
    try {
      url = requireUrl(input.value);
    } catch {
      renderOutcome(result, { kind: 'error', error: describeScanError('invalid-url') });
      return;
    }
    input.value = url;
    button.disabled = true;
    timer.hidden = false;
    timer.classList.remove('scan-timer--running');
    void timer.offsetWidth; // restart the 6-second bar
    timer.classList.add('scan-timer--running');
    result.innerHTML = `<div class="scan-now__waiting"><strong>Checking ${escapeHtml(new URL(url).hostname)}…</strong><span>Collecting antivirus results for up to ${SCANNING.quickScanDeadlineMs / 1000} seconds</span></div>`;
    try {
      const outcome = await sendMessage('scan:quick', { url });
      renderOutcome(result, outcome);
      fullAnalysis.hidden = outcome.kind !== 'report';
    } catch {
      renderOutcome(result, { kind: 'error', error: describeScanError('server-error') });
    } finally {
      button.disabled = false;
      timer.hidden = true;
      timer.classList.remove('scan-timer--running');
    }
    bindErrorState(result, { openSettings: () => ctx.navigate('settings'), retry: () => void scan() });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void scan();
  });
  fullAnalysis.addEventListener('click', () => {
    handOff('advancedUrl', { url: input.value, autostart: true });
    ctx.navigate('advanced');
  });

  const handoff = takeHandoff('scanUrl');
  if (handoff) {
    input.value = handoff.url;
    if (handoff.autostart) void scan();
    return;
  }
  const tab = await getActiveTab().catch(() => null);
  if (tab?.scannable) input.value = tab.url;
  input.focus();
}
