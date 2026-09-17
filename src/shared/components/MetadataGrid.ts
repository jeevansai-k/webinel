import { escapeHtml } from '../dom';

export interface MetadataItem {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}

/** Reusable key/value layout. Missing values render as an em dash. */
export function metadataGrid(items: MetadataItem[], options: { hideEmpty?: boolean } = {}): string {
  const rows = items
    .filter((item) => !options.hideEmpty || (item.value !== null && item.value !== undefined && item.value !== ''))
    .map((item) => {
      const empty = item.value === null || item.value === undefined || item.value === '';
      const value = empty ? '—' : String(item.value);
      return `<div class="meta-grid__row">
        <dt class="meta-grid__label">${escapeHtml(item.label)}</dt>
        <dd class="meta-grid__value${item.mono ? ' mono' : ''}${empty ? ' meta-grid__value--empty' : ''}" title="${escapeHtml(value)}">${escapeHtml(value)}</dd>
      </div>`;
    });
  return `<dl class="meta-grid">${rows.join('')}</dl>`;
}
