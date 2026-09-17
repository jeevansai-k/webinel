import { LocalStore } from './LocalStore';

export type Theme = 'dark' | 'light';

export interface Settings {
  realTimeProtection: boolean;
  /** When on, Suspicious sites are blocked like Dangerous ones instead of only warned. */
  blockSuspicious: boolean;
  downloadScanner: boolean;
  clipboardScanner: boolean;
  emailLinkScanner: boolean;
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
  realTimeProtection: true,
  blockSuspicious: false,
  downloadScanner: true,
  clipboardScanner: false,
  emailLinkScanner: false,
  theme: 'dark',
};

class SettingsStore extends LocalStore<Settings> {
  constructor() {
    super('settings', () => ({ ...DEFAULT_SETTINGS }));
  }

  override async get(): Promise<Settings> {
    // Merge so settings added in later versions receive their defaults.
    return { ...DEFAULT_SETTINGS, ...(await super.get()) };
  }

  override subscribe(listener: (value: Settings) => void): () => void {
    return super.subscribe((value) => listener({ ...DEFAULT_SETTINGS, ...value }));
  }

  patch(changes: Partial<Settings>): Promise<Settings> {
    return this.update((current) => ({ ...current, ...changes }));
  }
}

export const settingsStore = new SettingsStore();
