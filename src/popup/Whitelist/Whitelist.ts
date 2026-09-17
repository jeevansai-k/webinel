import { mountScreenHeader } from '../../shared/components/ScreenHeader';
import { showToast } from '../../shared/components/Toast';
import { escapeHtml, hydrateIcons, query } from '../../shared/dom';
import { icon, type IconName } from '../../shared/icons';
import { sendMessage } from '../../shared/messages';
import { whitelistStore } from '../../storage/WhitelistStore';
import { getActiveTab } from '../activeTab';
import { mountFooter } from '../Footer';
import type { Cleanup, ScreenContext } from '../router';
import template from './Whitelist.html?raw';
import './Whitelist.css';

export function renderWhitelist(root: HTMLElement, hosts: string[]): void {
  query(root, '[data-role="count"]').textContent = String(hosts.length);
  const list = query(root, '[data-role="list"]');
  if (hosts.length === 0) {
    list.innerHTML = `<li class="empty-state">${icon('whitelist', 22)}<span>No trusted sites yet.</span></li>`;
    return;
  }
  list.innerHTML = hosts
    .map(
      (host) => `<li class="list-row">
        <span class="row-icon">${icon('check', 14)}</span>
        <div class="list-row__main"><div class="list-row__title">${escapeHtml(host)}</div></div>
        <div class="row-actions">
          <button class="icon-btn" type="button" data-remove="${escapeHtml(host)}" aria-label="Remove ${escapeHtml(host)}" title="Remove">${icon('trash', 14)}</button>
        </div>
      </li>`,
    )
    .join('');
}

async function add(host: string): Promise<boolean> {
  try {
    await sendMessage('whitelist:add', { host });
    showToast(`Trusted ${host}`, 'success');
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Could not add site', 'error');
    return false;
  }
}

export async function mount(root: HTMLElement, ctx: ScreenContext): Promise<Cleanup> {
  root.innerHTML = template;
  hydrateIcons(root, (name, size) => icon(name as IconName, size));
  mountScreenHeader(root, 'Whitelist', 'whitelist', ctx.back);
  mountFooter(root, ctx.navigate);

  const input = query<HTMLInputElement>(root, '[data-role="input"]');
  query(root, '[data-role="form"]').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (input.value.trim() && (await add(input.value))) input.value = '';
  });

  query(root, '[data-role="list"]').addEventListener('click', async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-remove]');
    if (!button) return;
    await sendMessage('whitelist:remove', { host: button.dataset.remove! });
    showToast(`Removed ${button.dataset.remove}`, 'info');
  });

  const tab = await getActiveTab().catch(() => null);
  const current = query<HTMLButtonElement>(root, '[data-action="add-current"]');
  const hosts = await whitelistStore.get();
  if (tab?.host) {
    current.hidden = hosts.includes(tab.host);
    query(root, '[data-role="current-label"]').textContent = `Trust ${tab.host}`;
    current.addEventListener('click', async () => {
      if (await add(tab.host!)) current.hidden = true;
    });
  }

  renderWhitelist(root, hosts);
  return whitelistStore.subscribe((next) => renderWhitelist(root, next));
}
