/** Small DOM helpers. All dynamic text must pass through `escapeHtml` or `textContent`. */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** Finds a required element inside `root`, failing loudly if a template is out of sync. */
export function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

/** Replaces `[data-icon="name"]` placeholders in a template with inline SVG. */
export function hydrateIcons(root: ParentNode, render: (name: string, size: number) => string): void {
  for (const slot of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    slot.innerHTML = render(slot.dataset.icon!, Number(slot.dataset.iconSize ?? 20));
  }
}
