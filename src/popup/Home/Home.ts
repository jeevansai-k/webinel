import { activityChip, verdictChip } from '../../shared/components/VerdictChip';
import { escapeHtml, hydrateIcons, query } from '../../shared/dom';
import { icon, logoMark, type IconName } from '../../shared/icons';
import { sendMessage } from '../../shared/messages';
import type { Verdict } from '../../shared/verdict';
import { activityStore, type ActivityEntry } from '../../storage/ActivityStore';
import { settingsStore, type Settings } from '../../storage/SettingsStore';
import { formatRelativeTime } from '../../utils/time';
import { getActiveTab, type ActiveTabInfo } from '../activeTab';
import { mountFooter } from '../Footer';
import { handOff } from '../handoff';
import type { Cleanup, ScreenContext, ScreenName } from '../router';
import template from './Home.html?raw';
import './Home.css';

export function renderActivity(list: HTMLElement, entries: ActivityEntry[], now = Date.now()): void {
  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-state">${icon('globe', 22)}<span>No activity yet — browse and Webinel will report here.</span></li>`;
    return;
  }
  list.innerHTML = entries
    .map(
      (entry) => `<li class="list-row" data-host="${escapeHtml(entry.host)}">
        <span class="activity__site-icon">${icon('globe', 14)}</span>
        <div class="list-row__main">
          <div class="list-row__title">${escapeHtml(entry.host)}</div>
          <div class="list-row__meta">${escapeHtml(formatRelativeTime(entry.timestamp, now))}</div>
        </div>
        ${activityChip(entry.status)}
      </li>`,
    )
    .join('');
}

export function renderProtection(root: HTMLElement, settings: Settings): void {
  const card = query(root, '[data-role="protection"]');
  const enabled = settings.realTimeProtection;
  card.dataset.state = enabled ? 'on' : 'off';
  query(root, '[data-role="title"]').textContent = enabled ? "You're Protected" : 'Protection Paused';
  query(root, '[data-role="realtime"]').textContent = enabled ? 'Real-time Protection ON' : 'Real-time Protection OFF';
  const shieldIcon: IconName = enabled ? 'shieldCheck' : 'shieldAlert';
  query(root, '[data-role="shield-icon"]').innerHTML = icon(shieldIcon, 50);
}

function renderSite(root: HTMLElement, tab: ActiveTabInfo | null, verdict: Verdict | null): void {
  const domain = query(root, '[data-role="domain"]');
  domain.textContent = tab?.host ?? 'No website open';
  domain.title = tab?.host ?? '';
  query(root, '[data-role="site-verdict"]').innerHTML = tab?.scannable
    ? verdictChip(verdict, 'Not checked yet')
    : '<span class="chip chip--unknown">Nothing to scan</span>';
}

export async function mount(root: HTMLElement, ctx: ScreenContext): Promise<Cleanup> {
  root.innerHTML = template;
  hydrateIcons(root, (name, size) => icon(name as IconName, size));
  query(root, '[data-slot="logo"]').innerHTML = logoMark(34, 'home');
  mountFooter(root, ctx.navigate);

  query(root, '[data-action="settings"]').addEventListener('click', () => ctx.navigate('settings'));
  for (const tile of root.querySelectorAll<HTMLButtonElement>('[data-go]')) {
    tile.addEventListener('click', () => ctx.navigate(tile.dataset.go as ScreenName));
  }

  renderProtection(root, await settingsStore.get());
  const activityList = query(root, '[data-role="activity"]');
  renderActivity(activityList, await activityStore.get());

  const tab = await getActiveTab().catch(() => null);
  let verdict: Verdict | null = null;
  if (tab?.scannable) {
    const report = await sendMessage('tab:current-report', { tabId: tab.id }).catch(() => null);
    if (report && report.host === tab.host) verdict = report.verdict;
  }
  renderSite(root, tab, verdict);

  // One-click Scan Now for the current page.
  query<HTMLButtonElement>(root, '[data-action="scan"]').addEventListener('click', () => {
    // On non-web pages the user can paste a link instead.
    if (tab?.scannable) handOff('scanUrl', { url: tab.url, autostart: true });
    ctx.navigate('scan');
  });

  const unsubscribers = [
    settingsStore.subscribe((settings) => renderProtection(root, settings)),
    activityStore.subscribe((entries) => renderActivity(activityList, entries)),
  ];
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}
