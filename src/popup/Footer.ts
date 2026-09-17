/** Popup footer (20px): version, Privacy, Terms — nothing else. */
export function footerHtml(version: string): string {
  return `<footer class="popup-footer">
    <span data-role="version">v${version}</span>
    <span class="popup-footer__sep">•</span>
    <a href="#" data-legal="privacy">Privacy</a>
    <span class="popup-footer__sep">•</span>
    <a href="#" data-legal="terms">Terms</a>
  </footer>`;
}

export function appVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
}

export type LegalLink = 'privacy' | 'terms';

/** Renders the footer; Privacy / Terms open inside the popup via `openLegal`. */
export function mountFooter(root: HTMLElement, openLegal: (section: LegalLink) => void): void {
  const slot = root.querySelector<HTMLElement>('[data-slot="footer"]');
  if (!slot) return;
  slot.outerHTML = footerHtml(appVersion());
  for (const link of root.querySelectorAll<HTMLAnchorElement>('[data-legal]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      openLegal(link.dataset.legal as LegalLink);
    });
  }
}
