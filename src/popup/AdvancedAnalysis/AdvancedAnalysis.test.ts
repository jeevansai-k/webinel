import { describe, expect, it, vi } from 'vitest';
import { job, urlReport } from '../../../tests/fixtures/reports';
import { chromeFake, respondTo } from '../../../tests/setup/chromeMock';
import { mountScreen, setActiveTab, text } from '../../../tests/setup/screen';
import { describeScanError } from '../../shared/scanErrors';
import { analysisJobStore } from '../../storage/AnalysisJobStore';
import { settingsStore } from '../../storage/SettingsStore';
import { handOff } from '../handoff';
import { jobHtml, linksHtml, mount, redirectsHtml } from './AdvancedAnalysis';

function backend(overrides: Record<string, (payload: any) => unknown> = {}) {
  const start = vi.fn(async ({ url }: { url: string }) => {
    await analysisJobStore.put(job({ id: 'j-new', target: url, phase: 'submitting', polls: 0 }));
    return { kind: 'job', jobId: 'j-new' };
  });
  const cancel = vi.fn(() => ({ cancelled: true }));
  respondTo({ 'analysis:start-url': start, 'analysis:cancel': cancel, 'tab:redirects': () => [], ...overrides });
  return { start, cancel };
}

describe('Advanced Analysis screen', () => {
  it('starts a background analysis and shows live progress', async () => {
    setActiveTab('https://evil.test/login');
    const { start } = backend();
    const { root, cleanup } = await mountScreen(mount);
    expect(root.querySelector<HTMLInputElement>('[data-role="url"]')!.value).toBe('https://evil.test/login');
    root.querySelector<HTMLFormElement>('[data-role="form"]')!.requestSubmit();

    await vi.waitFor(() => expect(root.querySelector('.analysis-progress')).not.toBeNull());
    expect(start).toHaveBeenCalledWith({ url: 'https://evil.test/login' });
    expect(root.querySelector<HTMLButtonElement>('[data-action="analyze"]')!.disabled).toBe(true);

    await analysisJobStore.patch('j-new', { phase: 'in-progress', polls: 3, report: urlReport(1, { state: 'partial' }) });
    await vi.waitFor(() => expect(root.querySelector('[data-phase="in-progress"]')).not.toBeNull());
    expect(text(root.querySelector('[data-role="elapsed"]'))).toContain('3 checks');
    expect(root.querySelector('.analysis__partial .vendor-table__scroll')).not.toBeNull();

    // Live refreshes keep the vendor list where the user scrolled it.
    const list = root.querySelector<HTMLElement>('.vendor-table__scroll')!;
    list.scrollTop = 40;
    await analysisJobStore.patch('j-new', { polls: 4 });
    await vi.waitFor(() => expect(text(root.querySelector('[data-role="elapsed"]'))).toContain('4 checks'));
    expect(root.querySelector<HTMLElement>('.vendor-table__scroll')!.scrollTop).toBe(40);

    await analysisJobStore.patch('j-new', { phase: 'completed', report: urlReport(3) });
    await vi.waitFor(() => expect(root.querySelector('.report--full')).not.toBeNull());
    expect(root.querySelector('[data-section="whois"]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('[data-action="analyze"]')!.disabled).toBe(false);
    (cleanup as () => void)();
  });

  it('analyzes the current site with one click', async () => {
    setActiveTab('https://shop.example/checkout?step=2');
    const { start } = backend();
    await analysisJobStore.put(job({ id: 'old', phase: 'completed', report: urlReport(0), target: 'https://other.test/' }));
    const { root, cleanup } = await mountScreen(mount);
    const button = root.querySelector<HTMLButtonElement>('[data-action="current-site"]')!;
    expect(button.disabled).toBe(false);
    expect(text(button)).toBe('Current site shop.example');
    // The input shows the previous job until the button is used.
    expect(root.querySelector<HTMLInputElement>('[data-role="url"]')!.value).toBe('https://other.test/');
    button.click();
    await vi.waitFor(() => expect(start).toHaveBeenCalledWith({ url: 'https://shop.example/checkout?step=2' }));
    expect(root.querySelector<HTMLInputElement>('[data-role="url"]')!.value).toBe('https://shop.example/checkout?step=2');
    (cleanup as () => void)();
  });

  it('disables Current site on non-web pages', async () => {
    setActiveTab('chrome://settings');
    const { start } = backend();
    const { root, cleanup } = await mountScreen(mount);
    const button = root.querySelector<HTMLButtonElement>('[data-action="current-site"]')!;
    expect(button.disabled).toBe(true);
    expect(text(button.querySelector('[data-role="current-host"]'))).toBe('No website open');
    button.click();
    expect(start).not.toHaveBeenCalled();
    (cleanup as () => void)();
  });

  it('cancels a running analysis', async () => {
    const { cancel } = backend();
    await analysisJobStore.put(job({ id: 'running' }));
    const { root, cleanup } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-action="cancel-analysis"]')!.click();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith({ jobId: 'running' }));
    await analysisJobStore.patch('running', { phase: 'cancelled', error: describeScanError('cancelled') });
    await vi.waitFor(() => expect(root.querySelector('[data-error="cancelled"]')).not.toBeNull());
    (cleanup as () => void)();
  });

  it('reopens onto the latest completed report', async () => {
    backend();
    await analysisJobStore.put(job({ id: 'done', phase: 'completed', report: urlReport(2) }));
    const { root, cleanup } = await mountScreen(mount);
    expect(root.querySelector('.report--full')).not.toBeNull();
    expect(root.querySelector<HTMLInputElement>('[data-role="url"]')!.value).toBe('https://evil.test/login');
    (cleanup as () => void)();
  });

  it('auto-starts a URL handed over from Scan Now', async () => {
    const { start } = backend();
    handOff('advancedUrl', { url: 'https://handed.test/', autostart: true });
    const { cleanup } = await mountScreen(mount);
    await vi.waitFor(() => expect(start).toHaveBeenCalledWith({ url: 'https://handed.test/' }));
    (cleanup as () => void)();
  });

  it('shows error screens for invalid input and refused starts', async () => {
    const { start } = backend({ 'analysis:start-url': () => ({ kind: 'error', error: describeScanError('missing-key') }) });
    const { root, ctx, cleanup } = await mountScreen(mount);
    const input = root.querySelector<HTMLInputElement>('[data-role="url"]')!;
    input.value = 'nope';
    root.querySelector<HTMLFormElement>('[data-role="form"]')!.requestSubmit();
    await vi.waitFor(() => expect(root.querySelector('[data-error="invalid-url"]')).not.toBeNull());
    expect(start).not.toHaveBeenCalled();

    input.value = 'https://ok.test/';
    root.querySelector<HTMLFormElement>('[data-role="form"]')!.requestSubmit();
    await vi.waitFor(() => expect(root.querySelector('[data-error="missing-key"]')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-error-action="open-settings"]')!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('settings');
    (cleanup as () => void)();
  });

  it('renders each job phase', () => {
    const host = document.createElement('div');
    host.innerHTML = jobHtml(job({ phase: 'queued' }));
    expect(host.querySelector('.analysis-progress')).not.toBeNull();
    host.innerHTML = jobHtml(job({ phase: 'failed', error: describeScanError('rate-limited') }));
    expect(host.querySelector('[data-error="rate-limited"]')).not.toBeNull();
    host.innerHTML = jobHtml(job({ phase: 'failed', error: null }));
    expect(host.querySelector('[data-error="server-error"]')).not.toBeNull();
  });

  it('scans email links only when enabled, sending URLs only', async () => {
    setActiveTab('https://mail.example/inbox');
    const scanLinks = vi.fn(({ urls }: { urls: string[] }) => ({
      total: urls.length,
      counts: { safe: 1, suspicious: 0, dangerous: 1, unknown: 0, error: 0 },
      items: [
        { url: urls[0], host: 'evil.test', verdict: 'dangerous', reasons: ['bad'] },
        { url: urls[1], host: 'good.test', verdict: 'safe', reasons: [] },
      ],
    }));
    backend({ 'scan:links': scanLinks });
    chromeFake().scripting.executeScript.mockResolvedValue([{ result: ['https://evil.test/x', 'https://good.test/'] }]);

    const disabled = await mountScreen(mount);
    disabled.root.querySelector<HTMLButtonElement>('[data-action="scan-email"]')!.click();
    expect(chromeFake().scripting.executeScript).not.toHaveBeenCalled();
    (disabled.cleanup as () => void)();

    await settingsStore.patch({ emailLinkScanner: true });
    const { root, cleanup } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-action="scan-email"]')!.click();
    await vi.waitFor(() => expect(text(root.querySelector('[data-role="links"]'))).toContain('1 Dangerous'));
    expect(scanLinks).toHaveBeenCalledWith({ urls: ['https://evil.test/x', 'https://good.test/'] });
    (cleanup as () => void)();
  });

  it('reads the clipboard only on demand and never auto-submits a single link', async () => {
    const readText = vi.fn(async () => 'see https://one.test/a');
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });
    const { start } = backend();
    await settingsStore.patch({ clipboardScanner: true });
    const { root, cleanup } = await mountScreen(mount);
    expect(readText).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('[data-action="scan-clipboard"]')!.click();
    await vi.waitFor(() => expect(root.querySelector<HTMLInputElement>('[data-role="url"]')!.value).toBe('https://one.test/a'));
    expect(start).not.toHaveBeenCalled();
    (cleanup as () => void)();
  });

  it('renders redirect chains and link summaries', () => {
    const box = document.createElement('div');
    box.innerHTML = redirectsHtml([
      { from: 'bit.ly/x', to: 'a.test/', statusCode: 301, timestamp: 0 },
      { from: 'a.test/', to: 'b.test/', statusCode: 302, timestamp: 0 },
      { from: 'b.test/', to: 'evil.test/login', statusCode: 302, timestamp: 0 },
    ]);
    expect([...box.querySelectorAll('.hop__code')].map((node) => node.textContent)).toEqual(['301', '302', '302', 'END']);
    expect(text(box)).toContain('3 hops');
    expect(redirectsHtml([])).toContain('No redirects');
    expect(linksHtml({ total: 0, counts: { safe: 0, suspicious: 0, dangerous: 0, unknown: 0, error: 0 }, items: [] }, 'x')).toContain('No links');
  });
});
