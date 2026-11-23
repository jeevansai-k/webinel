import { escapeHtml } from '../dom';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive or risky actions. */
  tone?: 'default' | 'danger';
}

/**
 * In-page confirmation. Replaces `window.confirm`, which Firefox does not
 * support in extension popups and which closes Chrome's popup on some platforms.
 * Resolves `true` only when the user presses the confirm button.
 */
export function confirmDialog(options: ConfirmOptions, host: HTMLElement = document.body): Promise<boolean> {
  document.querySelector('.confirm-dialog')?.dispatchEvent(new Event('cancel'));

  const dialog = document.createElement('div');
  dialog.className = 'confirm-dialog';
  dialog.innerHTML = `<div class="confirm-dialog__panel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"${options.message ? ' aria-describedby="confirm-message"' : ''}>
    <h2 class="confirm-dialog__title" id="confirm-title">${escapeHtml(options.title)}</h2>
    ${options.message ? `<p class="confirm-dialog__message" id="confirm-message">${escapeHtml(options.message)}</p>` : ''}
    <div class="confirm-dialog__buttons">
      <button class="btn" type="button" data-answer="no">${escapeHtml(options.cancelLabel ?? 'Cancel')}</button>
      <button class="btn ${options.tone === 'danger' ? 'btn--danger' : 'btn--primary'}" type="button" data-answer="yes">${escapeHtml(options.confirmLabel ?? 'Confirm')}</button>
    </div>
  </div>`;

  const previousFocus = document.activeElement as HTMLElement | null;
  host.append(dialog);
  const cancelButton = dialog.querySelector<HTMLButtonElement>('[data-answer="no"]')!;
  const confirmButton = dialog.querySelector<HTMLButtonElement>('[data-answer="yes"]')!;
  cancelButton.focus();

  return new Promise<boolean>((resolve) => {
    const close = (answer: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      dialog.remove();
      previousFocus?.focus?.();
      resolve(answer);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      } else if (event.key === 'Tab') {
        // Keep focus inside the dialog.
        event.preventDefault();
        (document.activeElement === cancelButton ? confirmButton : cancelButton).focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    dialog.addEventListener('cancel', () => close(false));
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close(false);
    });
    cancelButton.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));
  });
}
