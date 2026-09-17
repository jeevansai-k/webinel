import { escapeHtml } from '../dom';
import { icon, type IconName } from '../icons';
import type { ScanErrorCode, ScanErrorInfo } from '../scanErrors';

const ICONS: Partial<Record<ScanErrorCode, IconName>> = {
  'missing-key': 'key',
  'invalid-key': 'key',
  forbidden: 'lock',
  'rate-limited': 'timeline',
  offline: 'globe',
  'file-too-large': 'document',
  'unsupported-file': 'document',
  'invalid-url': 'search',
};

const ACTION_TEXT = { 'open-settings': 'Open Settings', retry: 'Try again' } as const;

/** Dedicated error screen for scans. Shows friendly text only — never raw API errors. */
export function errorState(error: ScanErrorInfo): string {
  const action = error.action
    ? `<button class="btn ${error.action === 'open-settings' ? 'btn--primary' : ''}" type="button" data-error-action="${error.action}">${ACTION_TEXT[error.action]}</button>`
    : '';
  return `<section class="error-state glass" role="alert" data-error="${error.code}">
    <span class="error-state__icon">${icon(ICONS[error.code] ?? 'shieldAlert', 26)}</span>
    <h3 class="error-state__title">${escapeHtml(error.title)}</h3>
    <p class="error-state__message">${escapeHtml(error.message)}</p>
    ${action}
  </section>`;
}

export function bindErrorState(root: ParentNode, handlers: { openSettings?: () => void; retry?: () => void }): void {
  root.querySelector<HTMLButtonElement>('[data-error-action="open-settings"]')?.addEventListener('click', () => handlers.openSettings?.());
  root.querySelector<HTMLButtonElement>('[data-error-action="retry"]')?.addEventListener('click', () => handlers.retry?.());
}
