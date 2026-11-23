import '../shared/styles/theme.css';
import './Warning.css';
import { confirmDialog } from '../shared/components/ConfirmDialog';
import { showToast } from '../shared/components/Toast';
import { escapeHtml, query } from '../shared/dom';
import { icon, logoMark } from '../shared/icons';
import { sendMessage, type WarningDetails } from '../shared/messages';
import { initTheme } from '../shared/theme';
import { ContinueGate } from './ContinueGate';

export function renderWarning(root: ParentNode, details: WarningDetails | null): void {
  const title = query(root, '[data-role="title"]');
  const host = query(root, '[data-role="host"]');
  const reasons = query(root, '[data-role="reasons"]');
  if (!details) {
    title.textContent = 'Site blocked';
    host.textContent = 'This warning has expired';
    reasons.innerHTML = '';
    for (const id of ['continue', 'whitelist']) {
      query<HTMLButtonElement>(root, `[data-action="${id}"]`).hidden = true;
    }
    return;
  }
  title.textContent = details.verdict === 'dangerous' ? 'Dangerous site blocked' : 'Suspicious site blocked';
  host.textContent = details.host;
  host.title = details.host;
  reasons.innerHTML = details.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
}

async function leaveToSafety(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (!tab?.id) return;
  try {
    // Chromium allows navigating to its New Tab page.
    await chrome.tabs.update(tab.id, { url: 'chrome://newtab/' });
  } catch {
    // Firefox refuses privileged URLs: open the user's default new tab beside this one,
    // then close the blocked tab, so the window never disappears with it.
    await chrome.tabs.create({ active: true, index: tab.index + 1, windowId: tab.windowId }).catch(() => undefined);
    await chrome.tabs.remove(tab.id);
  }
}

export async function start(root: Document = document): Promise<ContinueGate> {
  await initTheme().catch(() => undefined);
  query(root, '[data-slot="logo"]').innerHTML = logoMark(34, 'warning');
  query(root, '[data-slot="shield"]').innerHTML = icon('shieldAlert', 64);

  const continueButton = query<HTMLButtonElement>(root, '[data-action="continue"]');
  const gate = new ContinueGate(continueButton, query(root, '[data-role="gate-overlay"]'));

  let warningId = '';
  const load = async () => {
    warningId = new URLSearchParams(location.search).get('id') ?? '';
    // Every warning starts with a fresh, locked gate.
    gate.reset();
    const details = warningId ? await sendMessage('warning:details', { id: warningId }).catch(() => null) : null;
    renderWarning(root, details);
  };

  continueButton.addEventListener('click', async () => {
    if (!gate.isReady()) return;
    try {
      const { url } = await sendMessage('warning:continue', { id: warningId });
      location.replace(url);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not continue', 'error');
    }
  });

  query(root, '[data-action="whitelist"]').addEventListener('click', async () => {
    const host = query(root, '[data-role="host"]').textContent ?? 'this site';
    const confirmed = await confirmDialog({
      title: `Always trust ${host}?`,
      message: 'Webinel will stop warning you about this site and its subdomains. You can undo this in Whitelist.',
      confirmLabel: 'Trust this site',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const { url } = await sendMessage('warning:whitelist', { id: warningId });
      location.replace(url);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not whitelist', 'error');
    }
  });

  query(root, '[data-action="back"]').addEventListener('click', () => void leaveToSafety());

  // Returning via back/forward cache must not skip the delay.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void load();
  });
  window.addEventListener('popstate', () => void load());

  await load();
  return gate;
}

if (!import.meta.env?.VITEST) void start();
