/**
 * Webinel content script. Collects a few structural page signals and reports
 * them to the background. It never reads or sends page text, form values,
 * cookies or keystrokes. Built as a standalone IIFE — keep it import-free
 * except for type-only imports.
 */
import type { Envelope, TabPageSignals } from '../shared/messages';

function collectSignals(): TabPageSignals {
  const passwordFields = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')];
  const pageHost = location.hostname;

  const postsElsewhere = passwordFields.some((field) => {
    const action = field.form?.getAttribute('action');
    if (!action) return false;
    try {
      const target = new URL(action, location.href);
      return /^https?:$/.test(target.protocol) && target.hostname !== pageHost;
    } catch {
      return false;
    }
  });

  const refresh = document.querySelector<HTMLMetaElement>('meta[http-equiv="refresh" i]')?.content ?? '';
  const refreshTarget = /url\s*=\s*['"]?([^'";]+)/i.exec(refresh)?.[1] ?? null;

  return {
    hasPasswordField: passwordFields.length > 0,
    passwordFormPostsToOtherHost: postsElsewhere,
    passwordFieldOnInsecurePage: passwordFields.length > 0 && location.protocol === 'http:',
    metaRefreshTarget: refreshTarget,
  };
}

let lastReported = '';

function report(): void {
  const signals = collectSignals();
  const fingerprint = JSON.stringify(signals);
  if (fingerprint === lastReported) return;
  lastReported = fingerprint;
  const message: Envelope<'page:signals'> = { channel: 'webinel', type: 'page:signals', payload: signals };
  chrome.runtime.sendMessage(message).catch(() => {
    // Background may be restarting; the next navigation will re-scan anyway.
  });
}

report();

// Single-page apps often render login forms late. Watch briefly, debounced.
let debounce: number | undefined;
const observer = new MutationObserver(() => {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(report, 500);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
window.setTimeout(() => observer.disconnect(), 30_000);
