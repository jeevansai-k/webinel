import { hostMatchesDomain } from '../utils/domain';
import { LocalStore } from './LocalStore';

/** Normalizes user input ("https://Example.com/path", "*.example.com") into a bare host. */
export function normalizeWhitelistEntry(input: string): string | null {
  let value = input.trim().toLowerCase().replace(/^\*\./, '');
  if (!value) return null;
  if (!/^[a-z][a-z\d+.-]*:\/\//.test(value)) value = `https://${value}`;
  try {
    const host = new URL(value).hostname.replace(/\.$/, '');
    return host.includes('.') || host === 'localhost' ? host : null;
  } catch {
    return null;
  }
}

class WhitelistStore extends LocalStore<string[]> {
  constructor() {
    super('whitelist', () => []);
  }

  async contains(host: string): Promise<boolean> {
    const entries = await this.get();
    return entries.some((entry) => hostMatchesDomain(host, entry));
  }

  add(input: string): Promise<string[]> {
    const host = normalizeWhitelistEntry(input);
    if (!host) return Promise.reject(new Error('Enter a valid domain, e.g. example.com'));
    return this.update((entries) => (entries.includes(host) ? entries : [...entries, host].sort()));
  }

  remove(host: string): Promise<string[]> {
    return this.update((entries) => entries.filter((entry) => entry !== host));
  }
}

export const whitelistStore = new WhitelistStore();
