/**
 * Per-browser-session state (chrome.storage.session): cleared when the browser
 * closes, survives service-worker restarts, not readable by content scripts.
 */
import { LIMITS } from '../shared/config';
import type { TabPageSignals, WarningDetails } from '../shared/messages';
import type { RedirectHop, ThreatReport } from '../shared/verdict';
import { LocalStore } from '../storage/LocalStore';

function sessionStore<T>(key: string, createDefault: () => T): LocalStore<T> {
  return new LocalStore<T>(key, createDefault, chrome.storage.session);
}

export const tabReports = sessionStore<Record<string, ThreatReport>>('tab.reports', () => ({}));
export const tabSignals = sessionStore<Record<string, TabPageSignals>>('tab.signals', () => ({}));
export const tabRedirects = sessionStore<Record<string, RedirectHop[]>>('tab.redirects', () => ({}));
export const pendingWarnings = sessionStore<Record<string, WarningDetails>>('warnings', () => ({}));
export const temporaryBypasses = sessionStore<Record<string, number>>('bypasses', () => ({}));

export async function setTabEntry<T>(store: LocalStore<Record<string, T>>, tabId: number, value: T): Promise<void> {
  await store.update((entries) => ({ ...entries, [String(tabId)]: value }));
}

export async function getTabEntry<T>(store: LocalStore<Record<string, T>>, tabId: number): Promise<T | null> {
  return (await store.get())[String(tabId)] ?? null;
}

export async function forgetTab(tabId: number): Promise<void> {
  const drop = <T>(entries: Record<string, T>) => {
    const { [String(tabId)]: _removed, ...rest } = entries;
    return rest;
  };
  await Promise.all([tabReports.update(drop), tabSignals.update(drop), tabRedirects.update(drop)]);
  await pendingWarnings.update((entries) =>
    Object.fromEntries(Object.entries(entries).filter(([, warning]) => warning.tabId !== tabId)),
  );
}

export async function grantTemporaryBypass(host: string, now = Date.now()): Promise<void> {
  await temporaryBypasses.update((entries) => ({ ...entries, [host]: now + LIMITS.temporaryBypassMs }));
}

export async function hasTemporaryBypass(host: string, now = Date.now()): Promise<boolean> {
  const expiresAt = (await temporaryBypasses.get())[host];
  return expiresAt !== undefined && expiresAt > now;
}
