import type { ProtectionAction, Verdict } from '../shared/verdict';

const BADGE: Record<Verdict, { text: string; color: string }> = {
  safe: { text: '✓', color: '#12a36b' },
  suspicious: { text: '!', color: '#d99a00' },
  dangerous: { text: '!!', color: '#e5484d' },
  unknown: { text: '?', color: '#5b6b82' },
  error: { text: '?', color: '#5b6b82' },
};

export async function showVerdictBadge(tabId: number, verdict: Verdict, action: ProtectionAction): Promise<void> {
  const badge = action === 'block' ? BADGE.dangerous : BADGE[verdict];
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
    await chrome.action.setBadgeText({ tabId, text: badge.text });
  } catch {
    // The tab may have closed while the scan was running.
  }
}

export async function clearBadge(tabId: number): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
  } catch {
    // Tab already gone.
  }
}
