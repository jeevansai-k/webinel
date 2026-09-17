import { mountScreenHeader } from '../../shared/components/ScreenHeader';
import { showToast } from '../../shared/components/Toast';
import { verdictChip } from '../../shared/components/VerdictChip';
import { escapeHtml, hydrateIcons, query } from '../../shared/dom';
import { icon, type IconName } from '../../shared/icons';
import { sendMessage } from '../../shared/messages';
import { bookmarkStore, type SecureBookmark } from '../../storage/BookmarkStore';
import { formatRelativeTime } from '../../utils/time';
import { getActiveTab } from '../activeTab';
import { mountFooter } from '../Footer';
import type { Cleanup, ScreenContext } from '../router';
import template from './Bookmarks.html?raw';
import './Bookmarks.css';

export function renderBookmarks(root: HTMLElement, bookmarks: SecureBookmark[]): void {
  query(root, '[data-role="count"]').textContent = String(bookmarks.length);
  const list = query(root, '[data-role="list"]');
  if (bookmarks.length === 0) {
    list.innerHTML = `<li class="empty-state">${icon('bookmark', 22)}<span>No secure bookmarks yet.</span></li>`;
    return;
  }
  list.innerHTML = bookmarks
    .map((bookmark) => {
      const checked = bookmark.lastCheckedAt ? `checked ${formatRelativeTime(bookmark.lastCheckedAt)}` : 'not checked yet';
      return `<li class="list-row bookmark-row" data-open="${bookmark.id}" tabindex="0" role="button" aria-label="Open ${escapeHtml(bookmark.title)}">
        <span class="row-icon">${icon('bookmark', 14)}</span>
        <div class="list-row__main">
          <div class="list-row__title">${escapeHtml(bookmark.title)}</div>
          <div class="list-row__meta">${escapeHtml(bookmark.host)} · ${escapeHtml(checked)}</div>
        </div>
        ${verdictChip(bookmark.lastVerdict, 'New')}
        <div class="row-actions">
          <button class="icon-btn" type="button" data-remove="${bookmark.id}" aria-label="Remove bookmark" title="Remove">${icon('trash', 14)}</button>
        </div>
      </li>`;
    })
    .join('');
}

/** Re-checks the bookmark first; dangerous sites are not opened directly. */
async function openBookmark(bookmark: SecureBookmark, row: HTMLElement): Promise<void> {
  row.setAttribute('aria-busy', 'true');
  try {
    const report = await sendMessage('scan:url', { url: bookmark.url, scope: 'domain' });
    await bookmarkStore.markChecked(bookmark.id, report.verdict);
    if (report.verdict === 'dangerous') {
      showToast(`Not opened: ${report.reasons[0] ?? 'this site is now flagged as dangerous'}`, 'error', 4000);
      return;
    }
    if (report.verdict === 'suspicious' && !window.confirm(`${bookmark.host} looks suspicious:\n${report.reasons[0] ?? ''}\n\nOpen anyway?`)) {
      return;
    }
    await chrome.tabs.create({ url: bookmark.url });
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Could not check bookmark', 'error');
  } finally {
    row.removeAttribute('aria-busy');
  }
}

export async function mount(root: HTMLElement, ctx: ScreenContext): Promise<Cleanup> {
  root.innerHTML = template;
  hydrateIcons(root, (name, size) => icon(name as IconName, size));
  mountScreenHeader(root, 'Secure Bookmarks', 'bookmark', ctx.back);
  mountFooter(root, ctx.navigate);

  const tab = await getActiveTab().catch(() => null);
  const addButton = query<HTMLButtonElement>(root, '[data-action="add-current"]');
  addButton.disabled = !tab?.scannable;
  if (tab?.host) query(root, '[data-role="add-label"]').textContent = `Bookmark ${tab.host}`;
  addButton.addEventListener('click', async () => {
    if (!tab?.scannable) return;
    try {
      await bookmarkStore.add(tab.url, tab.title);
      showToast('Bookmark saved', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save bookmark', 'error');
    }
  });

  const list = query(root, '[data-role="list"]');
  const activate = async (event: Event) => {
    const target = event.target as Element;
    const remove = target.closest<HTMLButtonElement>('[data-remove]');
    if (remove) {
      await bookmarkStore.remove(remove.dataset.remove!);
      return;
    }
    const row = target.closest<HTMLElement>('[data-open]');
    const bookmark = row && (await bookmarkStore.get()).find((item) => item.id === row.dataset.open);
    if (row && bookmark) await openBookmark(bookmark, row);
  };
  list.addEventListener('click', (event) => void activate(event));
  list.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.target as Element).matches('[data-open]')) void activate(event);
  });

  renderBookmarks(root, await bookmarkStore.get());
  return bookmarkStore.subscribe((bookmarks) => renderBookmarks(root, bookmarks));
}
