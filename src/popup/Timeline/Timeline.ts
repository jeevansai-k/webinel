import { mountScreenHeader } from '../../shared/components/ScreenHeader';
import { confirmDialog } from '../../shared/components/ConfirmDialog';
import { showToast } from '../../shared/components/Toast';
import { verdictTone } from '../../shared/components/VerdictChip';
import { escapeHtml, hydrateIcons, query } from '../../shared/dom';
import { icon, type IconName } from '../../shared/icons';
import { timelineStore, type TimelineEvent, type TimelineEventKind } from '../../storage/TimelineStore';
import { formatRelativeTime } from '../../utils/time';
import { mountFooter } from '../Footer';
import type { Cleanup, ScreenContext } from '../router';
import template from './Timeline.html?raw';
import './Timeline.css';

export type TimelineFilter = 'all' | 'threats' | 'scans' | 'changes';

const KIND_META: Record<TimelineEventKind, { label: string; icon: IconName; group: Exclude<TimelineFilter, 'all'> }> = {
  blocked: { label: 'Blocked', icon: 'shieldAlert', group: 'threats' },
  warned: { label: 'Warned', icon: 'shieldAlert', group: 'threats' },
  bypassed: { label: 'Warning bypassed', icon: 'bolt', group: 'threats' },
  'download-blocked': { label: 'Download blocked', icon: 'download', group: 'threats' },
  'download-paused': { label: 'Download paused', icon: 'download', group: 'threats' },
  'manual-scan': { label: 'Scanned', icon: 'search', group: 'scans' },
  'links-scanned': { label: 'Links scanned', icon: 'mail', group: 'scans' },
  'file-scanned': { label: 'Document scanned', icon: 'document', group: 'scans' },
  'full-analysis': { label: 'Full analysis', icon: 'analysis', group: 'scans' },
  'file-uploaded': { label: 'File uploaded', icon: 'upload', group: 'scans' },
  whitelisted: { label: 'Trusted', icon: 'whitelist', group: 'changes' },
  unwhitelisted: { label: 'Untrusted', icon: 'whitelist', group: 'changes' },
  'api-key-changed': { label: 'API key', icon: 'key', group: 'changes' },
};

export function filterEvents(events: TimelineEvent[], filter: TimelineFilter): TimelineEvent[] {
  return filter === 'all' ? events : events.filter((event) => KIND_META[event.kind]?.group === filter);
}

export function renderTimeline(list: HTMLElement, events: TimelineEvent[], now = Date.now()): void {
  if (events.length === 0) {
    list.innerHTML = `<li class="empty-state">${icon('timeline', 22)}<span>No security events yet.</span></li>`;
    return;
  }
  list.innerHTML = events
    .map((event) => {
      const meta = KIND_META[event.kind] ?? { label: event.kind, icon: 'shield' as IconName };
      const tone = event.verdict ? verdictTone(event.verdict) : 'accent';
      return `<li class="timeline-item" data-kind="${event.kind}">
        <span class="timeline-item__icon" data-tone="${tone}">${icon(meta.icon, 14)}</span>
        <div class="timeline-item__body">
          <div class="timeline-item__head">
            <span class="timeline-item__title">${escapeHtml(meta.label)} · ${escapeHtml(event.subject)}</span>
            <time class="timeline-item__time" datetime="${new Date(event.timestamp).toISOString()}">${escapeHtml(formatRelativeTime(event.timestamp, now))}</time>
          </div>
          <p class="timeline-item__detail">${escapeHtml(event.detail)}</p>
        </div>
      </li>`;
    })
    .join('');
}

export async function mount(root: HTMLElement, ctx: ScreenContext): Promise<Cleanup> {
  root.innerHTML = template;
  hydrateIcons(root, (name, size) => icon(name as IconName, size));
  mountScreenHeader(root, 'Timeline', 'timeline', ctx.back);
  mountFooter(root, ctx.navigate);

  const list = query(root, '[data-role="list"]');
  let filter: TimelineFilter = 'all';
  let events = await timelineStore.get();
  const render = () => renderTimeline(list, filterEvents(events, filter));

  for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
    tab.addEventListener('click', () => {
      filter = tab.dataset.filter as TimelineFilter;
      for (const other of root.querySelectorAll('[data-filter]')) {
        other.setAttribute('aria-selected', String(other === tab));
      }
      render();
    });
  }

  query(root, '[data-action="clear"]').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Clear the timeline?',
      message: 'Every recorded security event is deleted from this device. Statistics are kept.',
      confirmLabel: 'Clear timeline',
      tone: 'danger',
    });
    if (!confirmed) return;
    await timelineStore.set([]);
    showToast('Timeline cleared', 'info');
  });

  render();
  return timelineStore.subscribe((next) => {
    events = next;
    render();
  });
}
