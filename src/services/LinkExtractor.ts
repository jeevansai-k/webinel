/**
 * Email Link Scanner extraction.
 * `extractLinksFromPage` is injected with chrome.scripting.executeScript, so it
 * must be fully self-contained. It returns hyperlink targets only — never the
 * email body, subject, sender or any other text.
 */
export function extractLinksFromPage(): string[] {
  const MAIL_BODY_SELECTORS = [
    'div.a3s', // Gmail message body
    '[aria-label="Message body"]', // Outlook
    '.ReadMsgBody, .rps_',
    '[data-test-id="message-view-body-content"]', // Yahoo
    '.mail-Message-Body-Content', // Yandex
  ];
  const containers = MAIL_BODY_SELECTORS.flatMap((selector) => [...document.querySelectorAll(selector)]);
  const roots: ParentNode[] = containers.length > 0 ? containers : [document];
  const links = new Set<string>();
  for (const root of roots) {
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (/^https?:/i.test(anchor.href)) links.add(anchor.href);
      if (links.size >= 500) return [...links];
    }
  }
  return [...links];
}

/** Gmail and Outlook wrap links in redirectors; unwrap them so the real target is scanned. */
export function unwrapTrackingRedirect(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname;
    const wrapped =
      (host === 'www.google.com' && url.pathname === '/url' && (url.searchParams.get('q') ?? url.searchParams.get('url'))) ||
      (host.endsWith('safelinks.protection.outlook.com') && url.searchParams.get('url')) ||
      null;
    return wrapped && /^https?:\/\//i.test(wrapped) ? wrapped : rawUrl;
  } catch {
    return rawUrl;
  }
}
