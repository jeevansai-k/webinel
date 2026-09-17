import { describe, expect, it } from 'vitest';
import { chromeFake, respondTo } from '../../../tests/setup/chromeMock';
import { mountScreen, setActiveTab, text } from '../../../tests/setup/screen';
import { activityStore } from '../../storage/ActivityStore';
import { settingsStore } from '../../storage/SettingsStore';
import { takeHandoff } from '../handoff';
import { mount, renderActivity } from './Home';

describe('Home screen', () => {
  it('renders the header, brand and settings button', async () => {
    const { root, ctx } = await mountScreen(mount);
    expect(text(root.querySelector('.brand__name'))).toBe('Webinel');
    expect(text(root.querySelector('.brand__tagline'))).toBe('Your Web Sentinel');
    expect(root.querySelector('.brand__logo svg')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('settings');
  });

  it('shows six navigation tiles in a 2 × 3 order', async () => {
    const { root, ctx } = await mountScreen(mount);
    const tiles = [...root.querySelectorAll<HTMLButtonElement>('.tile-grid .tile')];
    expect(tiles.map((tile) => text(tile))).toEqual([
      'Whitelist',
      'Statistics',
      'Bookmarks',
      'Advanced Analysis',
      'Document Scanner',
      'Timeline',
    ]);
    expect(tiles.every((tile) => tile.classList.contains('glass') && tile.querySelector('svg'))).toBe(true);
    tiles[3]!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('advanced');
  });

  it('shows the protection status with the current domain', async () => {
    setActiveTab('https://news.example.org/story');
    respondTo({ 'tab:current-report': () => ({ host: 'news.example.org', verdict: 'safe' }) });
    const { root } = await mountScreen(mount);
    expect(text(root.querySelector('[data-role="domain"]'))).toBe('news.example.org');
    expect(text(root.querySelector('[data-role="title"]'))).toBe("You're Protected");
    expect(text(root.querySelector('[data-role="realtime"]'))).toBe('Real-time Protection ON');
    expect(root.querySelector('[data-role="protection"]')!.getAttribute('data-state')).toBe('on');
    expect(root.querySelector('[data-role="site-verdict"] [data-verdict="safe"]')).not.toBeNull();
  });

  it('never presents an unknown site as safe', async () => {
    setActiveTab('https://new.example/');
    respondTo({ 'tab:current-report': () => ({ host: 'new.example', verdict: 'unknown' }) });
    const { root } = await mountScreen(mount);
    const chip = root.querySelector('[data-role="site-verdict"]')!;
    expect(text(chip)).toBe('Unverified');
    expect(chip.querySelector('.chip--safe')).toBeNull();
  });

  it('reflects paused protection', async () => {
    await settingsStore.patch({ realTimeProtection: false });
    const { root } = await mountScreen(mount);
    expect(text(root.querySelector('[data-role="title"]'))).toBe('Protection Paused');
    expect(text(root.querySelector('[data-role="realtime"]'))).toBe('Real-time Protection OFF');
  });

  it('opens Scan Now for the current page', async () => {
    setActiveTab('https://shop.example/cart');
    respondTo({ 'tab:current-report': () => null });
    const { root, ctx } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-action="scan"]')!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('scan');
    expect(takeHandoff('scanUrl')).toEqual({ url: 'https://shop.example/cart', autostart: true });
  });

  it('opens an empty Scan Now on non-web pages so a link can be pasted', async () => {
    setActiveTab('chrome://extensions');
    const { root, ctx } = await mountScreen(mount);
    expect(text(root.querySelector('[data-role="domain"]'))).toBe('No website open');
    const scan = root.querySelector<HTMLButtonElement>('[data-action="scan"]')!;
    expect(scan.disabled).toBe(false);
    scan.click();
    expect(ctx.navigate).toHaveBeenCalledWith('scan');
    expect(takeHandoff('scanUrl')).toBeNull();
  });

  it('lists recent activity with safe, warning and blocked states', async () => {
    const now = Date.now();
    await activityStore.record({ host: 'ok.test', status: 'safe', timestamp: now - 60_000 });
    await activityStore.record({ host: 'odd.test', status: 'warning', timestamp: now - 30_000 });
    await activityStore.record({ host: 'bad.test', status: 'blocked', timestamp: now });
    const { root } = await mountScreen(mount);
    const rows = [...root.querySelectorAll('[data-role="activity"] .list-row')];
    expect(rows.map((row) => row.getAttribute('data-host'))).toEqual(['bad.test', 'odd.test', 'ok.test']);
    expect(rows.map((row) => text(row.querySelector('.chip')))).toEqual(['Blocked', 'Warning', 'Safe']);
    expect(text(rows[2]!.querySelector('.list-row__meta'))).toBe('1m ago');
  });

  it('escapes hostile host names', () => {
    const list = document.createElement('ul');
    renderActivity(list, [{ host: '<img src=x onerror=alert(1)>', status: 'safe', timestamp: 0 }]);
    expect(list.querySelector('img')).toBeNull();
  });

  it('opens Privacy and Terms inside the popup', async () => {
    const { root, ctx } = await mountScreen(mount);
    root.querySelector<HTMLAnchorElement>('[data-legal="privacy"]')!.click();
    root.querySelector<HTMLAnchorElement>('[data-legal="terms"]')!.click();
    expect(ctx.navigate.mock.calls).toEqual([['privacy'], ['terms']]);
    expect(chromeFake().tabs.create).not.toHaveBeenCalled();
  });

  it('shows an empty state and a footer', async () => {
    const { root } = await mountScreen(mount);
    expect(text(root.querySelector('[data-role="activity"]'))).toContain('No activity yet');
    expect(text(root.querySelector('.popup-footer'))).toBe('v1.0.0 • Privacy • Terms');
  });
});
