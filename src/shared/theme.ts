import { settingsStore, type Theme } from '../storage/SettingsStore';

const darkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** Resolves "system" to the operating system's current light/dark preference. */
export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  const query = darkQuery();
  return query && !query.matches ? 'light' : 'dark';
}

let current: Theme = 'system';

export function applyTheme(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = resolveTheme(theme);
}

/** Applies the stored theme and keeps the page in sync when it, or the OS preference, changes. */
export async function initTheme(): Promise<void> {
  applyTheme((await settingsStore.get()).theme);
  settingsStore.subscribe((settings) => applyTheme(settings.theme));
  darkQuery()?.addEventListener?.('change', () => {
    if (current === 'system') applyTheme('system');
  });
}
