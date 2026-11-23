import { describe, expect, it, vi } from 'vitest';
import { chromeFake, respondTo } from '../../../tests/setup/chromeMock';
import { flush, mountScreen, setActiveTab, text } from '../../../tests/setup/screen';
import { settingsStore } from '../../storage/SettingsStore';
import { healthLabel, MASKED_SECRET, mount, openEmailApp } from './Settings';

const KEY = 'f'.repeat(64);

function backend(configured: boolean) {
  const calls: Array<{ type: string; payload: unknown }> = [];
  const state = { configured };
  const responses = {
    'apiKey:status': () => ({ configured: state.configured }),
    'apiKey:set': (payload: { key: string }) => {
      state.configured = true;
      return payload.key.length === 64 ? { saved: true } : { saved: false, error: 'bad key' };
    },
    'apiKey:clear': () => ({ configured: (state.configured = false) }),
    'api:health': () => ({ state: 'online', checkedAt: 0, latencyMs: 120 }),
    'cache:clear': () => ({ cleared: 3 }),
  };
  respondTo(
    Object.fromEntries(
      Object.entries(responses).map(([type, fn]) => [
        type,
        (payload: any) => {
          calls.push({ type, payload });
          return (fn as (p: unknown) => unknown)(payload);
        },
      ]),
    ),
  );
  return calls;
}

describe('Settings screen', () => {
  it('has a back button and all required sections', async () => {
    backend(true);
    const { root, ctx } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(ctx.back).toHaveBeenCalled();
    const body = text(root);
    for (const label of ['VirusTotal API', 'Clipboard Scanner', 'Email Link Scanner', 'Theme', 'Contact Developer']) {
      expect(body).toContain(label);
    }
    expect(text(root.querySelector('.popup-footer'))).toContain('v1.0.0');
  });

  it('shows only a mask for a stored key, with pencil and refresh icons', async () => {
    backend(true);
    const { root } = await mountScreen(mount);
    expect(text(root.querySelector('[data-role="secret"]'))).toBe(MASKED_SECRET);
    expect(MASKED_SECRET).toBe('••••••••••••••••');
    expect(root.querySelector('[data-action="edit-key"] svg')).not.toBeNull();
    expect(root.querySelector('[data-action="check-health"] svg')).not.toBeNull();
    expect(text(root.querySelector('.vt-card__subtitle'))).toContain('Stored locally on this device.');
    expect(root.innerHTML).not.toContain(KEY);
  });

  it('opens an empty password editor from the pencil and saves the key', async () => {
    const calls = backend(true);
    const { root } = await mountScreen(mount);
    const editor = root.querySelector<HTMLFormElement>('[data-role="editor"]')!;
    const input = root.querySelector<HTMLInputElement>('[data-role="key-input"]')!;
    expect(editor.hidden).toBe(true);

    root.querySelector<HTMLButtonElement>('[data-action="edit-key"]')!.click();
    expect(editor.hidden).toBe(false);
    expect(input.value).toBe('');
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');

    input.value = KEY;
    editor.requestSubmit();
    await vi.waitFor(() => expect(editor.hidden).toBe(true));
    expect(input.value).toBe('');
    expect(calls.find((call) => call.type === 'apiKey:set')?.payload).toEqual({ key: KEY });
    expect(text(root.querySelector('[data-role="secret"]'))).toBe(MASKED_SECRET);
    // Saving triggers a reachability check automatically.
    await vi.waitFor(() => expect(text(root.querySelector('[data-role="health"]'))).toBe('Online · 120 ms'));
  });

  it('checks reachability with the refresh icon', async () => {
    const calls = backend(true);
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-action="check-health"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('[data-role="health"]')!.getAttribute('data-state')).toBe('online'));
    expect(calls.some((call) => call.type === 'api:health')).toBe(true);
  });

  it('prompts for a key when none is stored', async () => {
    backend(false);
    const { root } = await mountScreen(mount);
    expect(text(root.querySelector('[data-role="secret"]'))).toBe('No key added');
    expect(root.querySelector<HTMLButtonElement>('[data-action="check-health"]')!.disabled).toBe(true);
  });

  it('persists toggles and asks permission before enabling the clipboard scanner', async () => {
    backend(true);
    const { root } = await mountScreen(mount);
    const email = root.querySelector<HTMLInputElement>('[data-setting="emailLinkScanner"]')!;
    email.click();
    await flush();
    expect((await settingsStore.get()).emailLinkScanner).toBe(true);

    chromeFake().permissions.request.mockResolvedValueOnce(false);
    const clipboard = root.querySelector<HTMLInputElement>('[data-setting="clipboardScanner"]')!;
    clipboard.click();
    await flush();
    await flush();
    expect(clipboard.checked).toBe(false);
    expect((await settingsStore.get()).clipboardScanner).toBe(false);
    expect(chromeFake().permissions.request).toHaveBeenCalledWith({ permissions: ['clipboardRead'] });
  });

  it('switches the theme', async () => {
    backend(true);
    const { root } = await mountScreen(mount);
    expect(root.querySelector('[data-theme-option="system"]')!.getAttribute('aria-checked')).toBe('true');
    root.querySelector<HTMLButtonElement>('[data-theme-option="light"]')!.click();
    await flush();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect((await settingsStore.get()).theme).toBe('light');
    expect(text(root.querySelector('[data-role="theme-label"]'))).toBe('Light');
    expect(root.querySelector('[data-theme-option="light"]')!.getAttribute('aria-checked')).toBe('true');
    expect(root.querySelector('[data-theme-option="system"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('follows the system theme on Auto', async () => {
    backend(true);
    await settingsStore.patch({ theme: 'dark' });
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-theme-option="system"]')!.click();
    await flush();
    expect((await settingsStore.get()).theme).toBe('system');
    expect(text(root.querySelector('[data-role="theme-label"]'))).toBe('Match your system');
    expect(['dark', 'light']).toContain(document.documentElement.dataset.theme);
  });

  it('asks before removing the API key', async () => {
    backend(true);
    const { root } = await mountScreen(mount);
    root.querySelector<HTMLButtonElement>('[data-action="edit-key"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-action="remove-key"]')!.click();
    await flush();
    const dialog = document.querySelector('.confirm-dialog')!;
    expect(text(dialog.querySelector('.confirm-dialog__title'))).toBe('Remove your VirusTotal key?');
    dialog.querySelector<HTMLButtonElement>('[data-answer="no"]')!.click();
    await flush();
    expect(chromeFake().runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'apiKey:clear' }));
    expect(document.querySelector('.confirm-dialog')).toBeNull();
  });

  it('Contact Developer opens the email app and offers the GitHub page', async () => {
    backend(true);
    setActiveTab('https://news.example/article');
    const { root } = await mountScreen(mount);
    const panel = root.querySelector<HTMLElement>('[data-role="contact-panel"]')!;
    expect(panel.hidden).toBe(true);

    root.querySelector<HTMLButtonElement>('[data-action="contact"]')!.click();
    expect(panel.hidden).toBe(false);
    expect(root.querySelector('[data-action="contact"]')!.getAttribute('aria-expanded')).toBe('true');
    expect(text(panel.querySelector('[data-role="developer-email"]'))).toBe('kukkalajeevansai@gmail.com');
    const mailto = 'mailto:kukkalajeevansai@gmail.com?subject=Webinel%201.0.0%20%E2%80%94%20feedback';
    await vi.waitFor(() => expect(chromeFake().tabs.update).toHaveBeenCalledWith(11, { url: mailto }));

    root.querySelector<HTMLButtonElement>('[data-action="email-again"]')!.click();
    await vi.waitFor(() => expect(chromeFake().tabs.update).toHaveBeenCalledTimes(2));

    const github = root.querySelector<HTMLButtonElement>('[data-action="open-github"]')!;
    expect(text(github)).toBe('Visit developer GitHub');
    github.click();
    expect(chromeFake().tabs.create).toHaveBeenCalledWith({ url: 'https://github.com/jeevansai-k' });
  });

  it('opens the email app from a new tab when no web page is active', async () => {
    chromeFake().tabs.query.mockResolvedValue([{ id: 4, url: 'chrome://newtab/' } as chrome.tabs.Tab]);
    await openEmailApp('mailto:kukkalajeevansai@gmail.com');
    expect(chromeFake().tabs.update).not.toHaveBeenCalled();
    expect(chromeFake().tabs.create).toHaveBeenCalledWith({ url: 'mailto:kukkalajeevansai@gmail.com' });
  });

  it('formats health labels', () => {
    expect(healthLabel({ state: 'online', checkedAt: 0, latencyMs: 80 })).toBe('Online · 80 ms');
    expect(healthLabel({ state: 'invalid-key', checkedAt: 0, latencyMs: 80 })).toBe('Invalid key');
  });
});
