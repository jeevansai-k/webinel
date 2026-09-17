export type ToastTone = 'info' | 'success' | 'error';

let hideTimer: number | undefined;

/** Shows a single transient message at the bottom of the current page. */
export function showToast(message: string, tone: ToastTone = 'info', durationMs = 2600): void {
  let toast = document.querySelector<HTMLElement>('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add('toast--visible');
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => toast.classList.remove('toast--visible'), durationMs);
}
