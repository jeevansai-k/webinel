import { mountScreenHeader } from '../../shared/components/ScreenHeader';
import { confirmDialog } from '../../shared/components/ConfirmDialog';
import { showToast } from '../../shared/components/Toast';
import { DEVELOPER, developerMailto } from '../../shared/config';
import { hydrateIcons, query } from '../../shared/dom';
import { icon, type IconName } from '../../shared/icons';
import { sendMessage } from '../../shared/messages';
import { applyTheme, resolveTheme } from '../../shared/theme';
import type { ApiHealth, ApiHealthState } from '../../shared/verdict';
import { settingsStore, type Settings, type Theme } from '../../storage/SettingsStore';
import { appVersion, mountFooter } from '../Footer';
import type { ScreenContext } from '../router';
import template from './Settings.html?raw';
import './Settings.css';

type ToggleSetting = 'realTimeProtection' | 'blockSuspicious' | 'downloadScanner' | 'clipboardScanner' | 'emailLinkScanner';

export const MASKED_SECRET = '••••••••••••••••';

const HEALTH_TEXT: Record<ApiHealthState | 'checking', string> = {
  checking: 'Checking…',
  online: 'Online',
  'no-key': 'No key',
  'invalid-key': 'Invalid key',
  'quota-exceeded': 'Quota exceeded',
  unreachable: 'Unreachable',
};

export function healthLabel(health: ApiHealth): string {
  const base = HEALTH_TEXT[health.state];
  return health.state === 'online' && health.latencyMs !== null ? `${base} · ${health.latencyMs} ms` : base;
}

function renderSecret(root: HTMLElement, configured: boolean): void {
  const secret = query(root, '[data-role="secret"]');
  // The key itself is never sent to this page — only whether one exists.
  secret.textContent = configured ? MASKED_SECRET : 'No key added';
  secret.dataset.empty = String(!configured);
  query<HTMLButtonElement>(root, '[data-action="remove-key"]').hidden = !configured;
  query<HTMLButtonElement>(root, '[data-action="check-health"]').disabled = !configured;
}

function renderHealth(root: HTMLElement, state: ApiHealthState | 'checking' | 'idle', label = ''): void {
  const health = query(root, '[data-role="health"]');
  health.dataset.state = state;
  health.textContent = state === 'idle' ? '' : label || HEALTH_TEXT[state];
}

const THEME_TEXT: Record<Theme, string> = { system: 'Match your system', dark: 'Dark', light: 'Light' };

function renderTheme(root: HTMLElement, settings: Settings): void {
  for (const option of root.querySelectorAll<HTMLButtonElement>('[data-theme-option]')) {
    const selected = option.dataset.themeOption === settings.theme;
    option.setAttribute('aria-checked', String(selected));
    option.tabIndex = selected ? 0 : -1;
  }
  query(root, '[data-role="theme-label"]').textContent = THEME_TEXT[settings.theme];
  query(root, '[data-role="theme-icon"]').innerHTML = icon(resolveTheme(settings.theme) === 'light' ? 'sun' : 'moon', 16);
}

/**
 * Hands a mailto: link to the browser, which opens the user's email app.
 * Using the current web page means no empty tab is left behind; the page itself
 * does not navigate away for mailto: links.
 */
export async function openEmailApp(mailto: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [] as chrome.tabs.Tab[]);
  if (tab?.id !== undefined && /^https?:/i.test(tab.url ?? '')) {
    await chrome.tabs.update(tab.id, { url: mailto });
    return;
  }
  await chrome.tabs.create({ url: mailto });
}

async function requestClipboardPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ permissions: ['clipboardRead'] });
  } catch {
    return false;
  }
}

export async function mount(root: HTMLElement, ctx: ScreenContext): Promise<void> {
  root.innerHTML = template;
  hydrateIcons(root, (name, size) => icon(name as IconName, size));
  mountScreenHeader(root, 'Settings', 'settings', ctx.back);
  mountFooter(root, ctx.navigate);

  const editor = query<HTMLFormElement>(root, '[data-role="editor"]');
  const keyInput = query<HTMLInputElement>(root, '[data-role="key-input"]');
  const healthButton = query<HTMLButtonElement>(root, '[data-action="check-health"]');

  const { configured } = await sendMessage('apiKey:status', {}).catch(() => ({ configured: false }));
  renderSecret(root, configured);

  const closeEditor = () => {
    keyInput.value = '';
    editor.hidden = true;
  };

  const checkHealth = async () => {
    healthButton.disabled = true;
    healthButton.classList.add('icon-btn--spin');
    renderHealth(root, 'checking');
    try {
      const health = await sendMessage('api:health', {});
      renderHealth(root, health.state, healthLabel(health));
    } catch {
      renderHealth(root, 'unreachable');
    } finally {
      healthButton.classList.remove('icon-btn--spin');
      healthButton.disabled = false;
    }
  };

  query(root, '[data-action="edit-key"]').addEventListener('click', () => {
    editor.hidden = !editor.hidden;
    keyInput.value = '';
    if (!editor.hidden) keyInput.focus();
  });
  query(root, '[data-action="cancel-key"]').addEventListener('click', closeEditor);
  healthButton.addEventListener('click', () => void checkHealth());

  editor.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = keyInput.value.trim();
    if (!key) {
      showToast('Paste your API key first.', 'error');
      return;
    }
    const result = await sendMessage('apiKey:set', { key }).catch((error: Error) => ({ saved: false, error: error.message }));
    if (!result.saved) {
      showToast(result.error ?? 'Could not save the key.', 'error');
      return;
    }
    closeEditor();
    renderSecret(root, true);
    showToast('API key saved on this device.', 'success');
    void checkHealth();
  });

  query(root, '[data-action="remove-key"]').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Remove your VirusTotal key?',
      message: 'Reputation checks stop until you add a key again. Webinel cannot show the saved key, so keep a copy if you need it.',
      confirmLabel: 'Remove key',
      tone: 'danger',
    });
    if (!confirmed) return;
    await sendMessage('apiKey:clear', {});
    closeEditor();
    renderSecret(root, false);
    renderHealth(root, 'idle');
    showToast('API key removed.', 'info');
  });

  const settings = await settingsStore.get();
  for (const toggle of root.querySelectorAll<HTMLInputElement>('[data-setting]')) {
    const name = toggle.dataset.setting as ToggleSetting;
    toggle.checked = settings[name];
    toggle.addEventListener('change', async () => {
      if (name === 'clipboardScanner' && toggle.checked && !(await requestClipboardPermission())) {
        toggle.checked = false;
        showToast('Clipboard access was not granted.', 'error');
        return;
      }
      await settingsStore.patch({ [name]: toggle.checked });
    });
  }

  renderTheme(root, settings);
  const themeOptions = [...root.querySelectorAll<HTMLButtonElement>('[data-theme-option]')];
  const chooseTheme = async (theme: Theme) => {
    applyTheme(theme);
    renderTheme(root, await settingsStore.patch({ theme }));
  };
  themeOptions.forEach((option, index) => {
    option.addEventListener('click', () => void chooseTheme(option.dataset.themeOption as Theme));
    // Radio-group keyboard pattern: arrows move the selection.
    option.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const next = themeOptions[(index + (event.key === 'ArrowRight' ? 1 : themeOptions.length - 1)) % themeOptions.length]!;
      next.focus();
      void chooseTheme(next.dataset.themeOption as Theme);
    });
  });

  const contactButton = query<HTMLButtonElement>(root, '[data-action="contact"]');
  const contactPanel = query(root, '[data-role="contact-panel"]');
  query(root, '[data-role="developer-email"]').textContent = DEVELOPER.email;
  const emailDeveloper = async () => {
    try {
      await openEmailApp(developerMailto(appVersion()));
    } catch {
      showToast(`Could not open your email app. Write to ${DEVELOPER.email}`, 'error', 5000);
    }
  };
  contactButton.addEventListener('click', () => {
    contactPanel.hidden = false;
    contactButton.setAttribute('aria-expanded', 'true');
    void emailDeveloper();
  });
  query(root, '[data-action="email-again"]').addEventListener('click', () => void emailDeveloper());
  query(root, '[data-action="open-github"]').addEventListener('click', () => {
    void chrome.tabs.create({ url: DEVELOPER.github });
  });

  query(root, '[data-action="clear-cache"]').addEventListener('click', async () => {
    const { cleared } = await sendMessage('cache:clear', {});
    showToast(`Smart Cache cleared (${cleared} entr${cleared === 1 ? 'y' : 'ies'}).`, 'success');
  });
}
