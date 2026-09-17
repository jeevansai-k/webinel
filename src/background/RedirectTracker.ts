/**
 * Redirect Chain Analysis: observes (never blocks) top-level redirects and keeps
 * the latest chain per tab in session storage. Query strings are dropped.
 */
import { LIMITS } from '../shared/config';
import type { RedirectHop } from '../shared/verdict';
import { displayUrl } from '../utils/url';
import { getTabEntry, setTabEntry, tabRedirects } from './SessionState';

export class RedirectTracker {
  private readonly chains = new Map<string, RedirectHop[]>();

  onRedirect(requestId: string, from: string, to: string, statusCode: number): void {
    const chain = this.chains.get(requestId) ?? [];
    if (chain.length >= LIMITS.redirectHops) return;
    chain.push({ from: displayUrl(from, 120), to: displayUrl(to, 120), statusCode, timestamp: Date.now() });
    this.chains.set(requestId, chain);
  }

  /** Called when the main-frame request finishes (successfully or not). */
  async onRequestFinished(requestId: string, tabId: number): Promise<void> {
    const chain = this.chains.get(requestId);
    this.chains.delete(requestId);
    if (tabId < 0) return;
    await setTabEntry(tabRedirects, tabId, chain ?? []);
  }

  async chainFor(tabId: number): Promise<RedirectHop[]> {
    return (await getTabEntry(tabRedirects, tabId)) ?? [];
  }
}
