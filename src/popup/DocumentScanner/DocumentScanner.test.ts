import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileScanReport, job } from '../../../tests/fixtures/reports';
import { chromeFake, respondTo } from '../../../tests/setup/chromeMock';
import { mountScreen, text } from '../../../tests/setup/screen';
import { sha256OfBlob } from '../../services/HashService';
import { memoryStaging } from '../../services/UploadStaging';
import { describeScanError } from '../../shared/scanErrors';
import { analysisJobStore } from '../../storage/AnalysisJobStore';
import { consentHtml, declinedHtml, mount, uploadDeps } from './DocumentScanner';

let staging: ReturnType<typeof memoryStaging>;

beforeEach(() => {
  staging = memoryStaging();
  uploadDeps.staging = staging;
});

function drop(root: HTMLElement, file: File) {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
  root.querySelector('[data-role="dropzone"]')!.dispatchEvent(event);
}

describe('Document Scanner screen', () => {
  it('sends only the SHA-256 fingerprint, never the file contents', async () => {
    const content = 'Quarterly numbers — confidential';
    const lookup = vi.fn(() => ({ kind: 'report', report: fileScanReport(0) }));
    respondTo({ 'file:lookup': lookup });
    const { root, cleanup } = await mountScreen(mount);
    drop(root, new File([content], 'report.pdf', { type: 'application/pdf' }));

    await vi.waitFor(() => expect(root.querySelector('[data-role="result"] .detection-circle')).not.toBeNull());
    expect(text(root.querySelector('.documents__known'))).toContain('no upload is needed');
    expect(lookup).toHaveBeenCalledWith({ fileName: 'report.pdf', sha256: await sha256OfBlob(new Blob([content])), size: new Blob([content]).size, mimeType: 'application/pdf' });
    expect(JSON.stringify(chromeFake().runtime.sendMessage.mock.calls)).not.toContain('confidential');
    expect(staging.size()).toBe(0);
    (cleanup as () => void)();
  });

  it('rejects unsupported and oversized files locally', async () => {
    const lookup = vi.fn();
    respondTo({ 'file:lookup': lookup });
    const { root, cleanup } = await mountScreen(mount);
    drop(root, new File(['x'], 'macro.docm'));
    await vi.waitFor(() => expect(root.querySelector('[data-error="unsupported-file"]')).not.toBeNull());

    const big = new File(['x'], 'huge.zip');
    Object.defineProperty(big, 'size', { value: 33 * 1024 * 1024 });
    drop(root, big);
    await vi.waitFor(() => expect(root.querySelector('[data-error="file-too-large"]')).not.toBeNull());
    expect(lookup).not.toHaveBeenCalled();
    (cleanup as () => void)();
  });

  it('asks before uploading an unknown file and uploads only after approval', async () => {
    const upload = vi.fn(async ({ meta }: { meta: { fileName: string } }) => {
      await analysisJobStore.put(job({ id: 'up', kind: 'file', target: meta.fileName, phase: 'uploading', polls: 0 }));
      return { kind: 'job', jobId: 'up' };
    });
    respondTo({ 'file:lookup': ({ sha256 }: { sha256: string }) => ({ kind: 'needs-upload', sha256 }), 'file:upload': upload });
    const { root, cleanup } = await mountScreen(mount);
    drop(root, new File(['new bytes'], 'tool.exe'));

    await vi.waitFor(() => expect(root.querySelector('[data-role="consent"]')).not.toBeNull());
    expect(text(root.querySelector('.consent__text'))).toContain('Do not upload private or confidential documents');
    expect(upload).not.toHaveBeenCalled();
    expect(staging.size()).toBe(0);

    root.querySelector<HTMLButtonElement>('[data-action="approve-upload"]')!.click();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const request = upload.mock.calls[0]![0] as unknown as { consent: boolean; stagingId: string; meta: { sha256: string } };
    expect(request.consent).toBe(true);
    expect(request.meta.sha256).toBe(await sha256OfBlob(new Blob(['new bytes'])));
    expect(staging.size()).toBe(1); // handed to the background, which removes it

    await vi.waitFor(() => expect(root.querySelector('.analysis-progress')).not.toBeNull());
    await analysisJobStore.patch('up', { phase: 'completed', report: fileScanReport(4) });
    await vi.waitFor(() => expect(root.querySelector('[data-kind="file"]')).not.toBeNull());
    (cleanup as () => void)();
  });

  it('never uploads when the user declines', async () => {
    const upload = vi.fn();
    respondTo({ 'file:lookup': ({ sha256 }: { sha256: string }) => ({ kind: 'needs-upload', sha256 }), 'file:upload': upload });
    const { root, cleanup } = await mountScreen(mount);
    drop(root, new File(['secret'], 'contract.pdf'));
    await vi.waitFor(() => expect(root.querySelector('[data-role="consent"]')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-action="decline-upload"]')!.click();
    expect(root.querySelector('[data-role="declined"]')).not.toBeNull();
    expect(text(root.querySelector('[data-role="declined"] .chip'))).toBe('Unverified');
    root.querySelector<HTMLButtonElement>('[data-action="reconsider"]')!.click();
    expect(root.querySelector('[data-role="consent"]')).not.toBeNull();
    expect(upload).not.toHaveBeenCalled();
    expect(staging.size()).toBe(0);
    (cleanup as () => void)();
  });

  it('shows error states from the lookup', async () => {
    respondTo({ 'file:lookup': () => ({ kind: 'error', error: describeScanError('missing-key') }) });
    const { root, ctx, cleanup } = await mountScreen(mount);
    drop(root, new File(['x'], 'a.png'));
    await vi.waitFor(() => expect(root.querySelector('[data-error="missing-key"]')).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-error-action="open-settings"]')!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('settings');
    (cleanup as () => void)();
  });

  it('checks links inside text files locally', async () => {
    const scanLinks = vi.fn(({ urls }: { urls: string[] }) => ({
      total: urls.length,
      counts: { safe: 0, suspicious: 1, dangerous: 0, unknown: 0, error: 0 },
      items: [{ url: urls[0], host: 'odd.test', verdict: 'suspicious', reasons: ['odd'] }],
    }));
    respondTo({ 'file:lookup': () => ({ kind: 'report', report: fileScanReport(0) }), 'scan:links': scanLinks });
    const { root, cleanup } = await mountScreen(mount);
    drop(root, new File(['Pay here: https://odd.test/pay now'], 'mail.txt'));
    await vi.waitFor(() => expect(scanLinks).toHaveBeenCalledWith({ urls: ['https://odd.test/pay'] }));
    (cleanup as () => void)();
  });

  it('on Windows/Linux, choosing a file opens the Webinel scanner window — never a browser tab', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const { root, cleanup } = await mountScreen(mount);
    const input = root.querySelector<HTMLInputElement>('[data-role="file"]')!;
    expect(input.accept).toBe('.pdf,.docx,.xlsx,.zip,.exe,.apk,.png,.jpg,.jpeg,.gif,.txt');
    expect(root.querySelector<HTMLElement>('[data-role="picker-hint"]')!.hidden).toBe(false);
    const nativePicker = vi.fn();
    input.addEventListener('click', nativePicker);

    root.querySelector<HTMLElement>('[data-role="dropzone"]')!.click();
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    expect(nativePicker).not.toHaveBeenCalled();
    expect(chromeFake().windows.create).toHaveBeenCalledWith({
      url: 'chrome-extension://webinel-test/popup/index.html?mode=window#documents',
      type: 'popup',
      width: 440,
      height: 600,
      focused: true,
    });
    expect(chromeFake().tabs.create).not.toHaveBeenCalled();
    (cleanup as () => void)();
  });

  describe('side panel', () => {
    const withChromeSidePanel = (open = vi.fn(async () => undefined)) => {
      (chromeFake() as unknown as { sidePanel?: unknown }).sidePanel = { open };
      return open;
    };
    const cleanupPanels = () => {
      delete (chromeFake() as unknown as { sidePanel?: unknown }).sidePanel;
      delete (globalThis as { browser?: unknown }).browser;
    };

    it('opens the scanner in the Chrome side panel instead of a separate window', async () => {
      const open = withChromeSidePanel();
      const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
      const { root, cleanup } = await mountScreen(mount);
      expect(text(root.querySelector('[data-role="picker-hint"]'))).toContain('side panel');
      await vi.waitFor(() => expect(chromeFake().windows.getCurrent).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      root.querySelector<HTMLElement>('[data-role="dropzone"]')!.click();
      // Called synchronously inside the click, as the browser requires.
      expect(open).toHaveBeenCalledWith({ windowId: 99 });
      await vi.waitFor(() => expect(close).toHaveBeenCalled());
      expect(chromeFake().windows.create).not.toHaveBeenCalled();
      (cleanup as () => void)();
      cleanupPanels();
    });

    it('opens the Firefox sidebar, on every OS', async () => {
      const open = vi.fn(async () => undefined);
      (globalThis as { browser?: unknown }).browser = { sidebarAction: { open }, runtime: { getBrowserInfo: vi.fn() } };
      chromeFake().runtime.getPlatformInfo.mockResolvedValue({ os: 'mac', arch: 'arm', nacl_arch: 'arm' });
      const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
      const { root, cleanup } = await mountScreen(mount);
      const nativePicker = vi.fn();
      root.querySelector<HTMLInputElement>('[data-role="file"]')!.addEventListener('click', nativePicker);
      root.querySelector<HTMLElement>('[data-role="dropzone"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(open).toHaveBeenCalledTimes(1);
      expect(nativePicker).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(close).toHaveBeenCalled());
      (cleanup as () => void)();
      cleanupPanels();
    });

    it('falls back to the scanner window when the side panel refuses to open', async () => {
      withChromeSidePanel(vi.fn(async () => Promise.reject(new Error('no gesture'))));
      vi.spyOn(window, 'close').mockImplementation(() => undefined);
      const { root, cleanup } = await mountScreen(mount);
      await new Promise((resolve) => setTimeout(resolve, 0));
      root.querySelector<HTMLElement>('[data-role="dropzone"]')!.click();
      await vi.waitFor(() => expect(chromeFake().windows.create).toHaveBeenCalled());
      (cleanup as () => void)();
      cleanupPanels();
    });

    it('uses the native chooser inside the side panel itself', async () => {
      withChromeSidePanel();
      window.history.replaceState(null, '', '/popup/index.html?mode=panel#documents');
      const { root, cleanup } = await mountScreen(mount);
      const nativePicker = vi.fn();
      root.querySelector<HTMLInputElement>('[data-role="file"]')!.addEventListener('click', nativePicker);
      root.querySelector<HTMLElement>('[data-role="dropzone"]')!.click();
      expect(nativePicker).toHaveBeenCalledTimes(1);
      expect(root.querySelector<HTMLElement>('[data-role="picker-hint"]')!.hidden).toBe(true);
      (cleanup as () => void)();
      cleanupPanels();
      window.history.replaceState(null, '', '/');
    });
  });

  it('starts only one upload however many times Upload is pressed', async () => {
    const upload = vi.fn(async () => {
      await analysisJobStore.put(job({ id: 'once', kind: 'file', target: 'new.exe', phase: 'uploading', polls: 0 }));
      return { kind: 'job', jobId: 'once' };
    });
    respondTo({ 'file:lookup': ({ sha256 }: { sha256: string }) => ({ kind: 'needs-upload', sha256 }), 'file:upload': upload });
    const { root, cleanup } = await mountScreen(mount);
    drop(root, new File(['fresh bytes'], 'new.exe'));
    const approve = await vi.waitFor(() => {
      const found = root.querySelector<HTMLButtonElement>('[data-action="approve-upload"]');
      if (!found) throw new Error('consent not shown yet');
      return found;
    });
    const decline = root.querySelector<HTMLButtonElement>('[data-action="decline-upload"]')!;
    approve.click();
    expect(approve.disabled).toBe(true);
    expect(decline.disabled).toBe(true);
    approve.click();
    await vi.waitFor(() => expect(root.querySelector('.analysis-progress')).not.toBeNull());
    expect(upload).toHaveBeenCalledTimes(1);
    expect(chromeFake().runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'analysis:cancel' }));
    (cleanup as () => void)();
  });

  it('explains a failed handoff instead of claiming the analysis was cancelled', async () => {
    uploadDeps.staging = { ...memoryStaging(), put: async () => Promise.reject(new Error('IDB unavailable')) };
    respondTo({ 'file:lookup': ({ sha256 }: { sha256: string }) => ({ kind: 'needs-upload', sha256 }) });
    const { root, cleanup } = await mountScreen(mount);
    drop(root, new File(['fresh bytes'], 'new.exe'));
    (await vi.waitFor(() => {
      const found = root.querySelector<HTMLButtonElement>('[data-action="approve-upload"]');
      if (!found) throw new Error('consent not shown yet');
      return found;
    })).click();
    await vi.waitFor(() => expect(text(root.querySelector('[data-role="result"]'))).toContain('could not reach Webinel'));
    expect(text(root.querySelector('[data-role="result"]'))).not.toContain('cancelled');
    (cleanup as () => void)();
  });

  it('focuses an existing scanner window instead of opening another', async () => {
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    chromeFake().tabs.query.mockResolvedValue([{ id: 3, windowId: 77, url: 'chrome-extension://webinel-test/popup/index.html?mode=window#documents' } as chrome.tabs.Tab]);
    const { root, cleanup } = await mountScreen(mount);
    root.querySelector<HTMLElement>('[data-role="dropzone"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(chromeFake().windows.update).toHaveBeenCalledWith(77, { focused: true }));
    expect(chromeFake().windows.create).not.toHaveBeenCalled();
    (cleanup as () => void)();
  });

  it('opens the native file chooser directly inside the scanner window and on macOS', async () => {
    for (const setup of [
      () => window.history.replaceState(null, '', '/popup/index.html?mode=window#documents'),
      () => chromeFake().runtime.getPlatformInfo.mockResolvedValue({ os: 'mac', arch: 'arm', nacl_arch: 'arm' }),
    ]) {
      window.history.replaceState(null, '', '/');
      setup();
      const { root, cleanup } = await mountScreen(mount);
      const input = root.querySelector<HTMLInputElement>('[data-role="file"]')!;
      const nativePicker = vi.fn();
      input.addEventListener('click', nativePicker);
      root.querySelector<HTMLElement>('[data-role="dropzone"]')!.click();
      root.querySelector<HTMLElement>('[data-role="dropzone"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(nativePicker).toHaveBeenCalledTimes(2);
      expect(root.querySelector<HTMLElement>('[data-role="picker-hint"]')!.hidden).toBe(true);
      expect(chromeFake().windows.create).not.toHaveBeenCalled();
      (cleanup as () => void)();
      root.remove();
    }
    window.history.replaceState(null, '', '/');
  });

  it('shows the Upload to VirusTotal button in the scanner window and uploads from there', async () => {
    window.history.replaceState(null, '', '/popup/index.html?mode=window#documents');
    const upload = vi.fn(async () => {
      await analysisJobStore.put(job({ id: 'w-up', kind: 'file', target: 'picked.exe', phase: 'uploading', polls: 0 }));
      return { kind: 'job', jobId: 'w-up' };
    });
    respondTo({ 'file:lookup': ({ sha256 }: { sha256: string }) => ({ kind: 'needs-upload', sha256 }), 'file:upload': upload });
    const { root, cleanup } = await mountScreen(mount);
    const input = root.querySelector<HTMLInputElement>('[data-role="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['brand new'], 'picked.exe')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(root.querySelector('[data-action="approve-upload"]')).not.toBeNull());
    expect(text(root.querySelector('[data-action="approve-upload"]'))).toBe('Upload to VirusTotal');
    root.querySelector<HTMLButtonElement>('[data-action="approve-upload"]')!.click();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(root.querySelector('.analysis-progress')).not.toBeNull());
    (cleanup as () => void)();
    window.history.replaceState(null, '', '/');
  });

  it('scans a file chosen with the picker', async () => {
    respondTo({ 'file:lookup': () => ({ kind: 'report', report: fileScanReport(1) }) });
    const { root, cleanup } = await mountScreen(mount);
    const input = root.querySelector<HTMLInputElement>('[data-role="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['abc'], 'picked.pdf')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(root.querySelector('[data-kind="file"]')).not.toBeNull());
    (cleanup as () => void)();
  });

  it('renders the consent and declined cards safely', () => {
    const meta = { fileName: '<img src=x>.pdf', sha256: 'a'.repeat(64), size: 10, mimeType: null };
    const host = document.createElement('div');
    host.innerHTML = consentHtml(meta) + declinedHtml(meta);
    expect(host.querySelector('img')).toBeNull();
  });
});
