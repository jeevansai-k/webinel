import { escapeHtml } from '../dom';
import { icon, type IconName } from '../icons';

/** Back button + title used by every secondary popup screen. */
export function screenHeader(title: string, iconName: IconName): string {
  return `<header class="screen-header">
    <button class="icon-btn" type="button" data-action="back" aria-label="Back">${icon('back', 18)}</button>
    <span class="screen-header__icon">${icon(iconName, 18)}</span>
    <h1 class="screen-header__title">${escapeHtml(title)}</h1>
  </header>`;
}

export function mountScreenHeader(root: HTMLElement, title: string, iconName: IconName, onBack: () => void): void {
  const slot = root.querySelector<HTMLElement>('[data-slot="header"]');
  if (!slot) return;
  slot.outerHTML = screenHeader(title, iconName);
  root.querySelector<HTMLButtonElement>('[data-action="back"]')?.addEventListener('click', onBack);
}
