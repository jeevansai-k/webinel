import { settingsStore, type Theme } from '../storage/SettingsStore';

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Applies the stored theme and keeps the page in sync when it changes elsewhere. */
export async function initTheme(): Promise<void> {
  applyTheme((await settingsStore.get()).theme);
  settingsStore.subscribe((settings) => applyTheme(settings.theme));
}
