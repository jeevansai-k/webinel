import { escapeHtml } from '../dom';
import type { VendorResult, VendorVerdict } from '../scan';

const VERDICT_TEXT: Record<VendorVerdict, string> = {
  malicious: 'Malicious',
  suspicious: 'Suspicious',
  clean: 'Clean',
  undetected: 'Undetected',
};

/** Green → Clean, Yellow → Suspicious, Red → Malicious, Gray → Undetected. */
const VERDICT_TONE: Record<VendorVerdict, string> = {
  malicious: 'danger',
  suspicious: 'warn',
  clean: 'safe',
  undetected: 'unknown',
};

const SPECIAL_CATEGORIES: Record<string, string> = {
  timeout: 'Timeout',
  'confirmed-timeout': 'Timeout',
  'type-unsupported': 'Unsupported',
  failure: 'Failed',
};

function verdictLabel(vendor: VendorResult): string {
  if (vendor.verdict === 'undetected' && SPECIAL_CATEGORIES[vendor.category]) return SPECIAL_CATEGORIES[vendor.category]!;
  if ((vendor.verdict === 'malicious' || vendor.verdict === 'suspicious') && vendor.label) return vendor.label;
  return VERDICT_TEXT[vendor.verdict];
}

export function vendorCounts(vendors: VendorResult[]): Record<VendorVerdict, number> {
  const counts: Record<VendorVerdict, number> = { malicious: 0, suspicious: 0, clean: 0, undetected: 0 };
  for (const vendor of vendors) counts[vendor.verdict] += 1;
  return counts;
}

/**
 * The one vendor table used by every report (URL, file, advanced). Rows come
 * straight from VirusTotal — no vendor list is hard-coded.
 */
export interface VendorTableOptions {
  /** Rows shown before "Show all" (collapsed mode). */
  limit?: number;
  /** Show every vendor inside a fixed-height scrolling list instead of collapsing. */
  scroll?: boolean;
}

export function vendorTable(vendors: VendorResult[], options: VendorTableOptions = {}): string {
  if (vendors.length === 0) {
    return '<div class="vendor-table vendor-table--empty"><p class="empty-state">No antivirus results yet.</p></div>';
  }
  const limit = options.scroll ? Number.POSITIVE_INFINITY : options.limit ?? 12;
  const counts = vendorCounts(vendors);
  const summary = (Object.keys(counts) as VendorVerdict[])
    .filter((verdict) => counts[verdict] > 0)
    .map((verdict) => `<span class="chip chip--${VERDICT_TONE[verdict]}">${counts[verdict]} ${VERDICT_TEXT[verdict]}</span>`)
    .join('');
  const rows = vendors
    .map(
      (vendor, index) => `<tr class="vendor-table__row" data-verdict="${vendor.verdict}"${index >= limit ? ' hidden' : ''}>
        <td class="vendor-table__engine">${escapeHtml(vendor.engine)}</td>
        <td class="vendor-table__verdict"><span class="chip chip--${VERDICT_TONE[vendor.verdict]}" title="${escapeHtml(vendor.label ?? vendor.category)}"><i class="chip__dot"></i>${escapeHtml(verdictLabel(vendor))}</span></td>
      </tr>`,
    )
    .join('');
  const more = vendors.length > limit
    ? `<button class="btn btn--block vendor-table__more" type="button" data-action="toggle-vendors" data-limit="${limit}" aria-expanded="false">Show all ${vendors.length} vendors</button>`
    : '';
  const table = `<table>
      <thead><tr><th scope="col">Antivirus</th><th scope="col">Verdict</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  if (options.scroll) {
    return `<div class="vendor-table vendor-table--scroll">
    <div class="vendor-table__summary">${summary}</div>
    <div class="vendor-table__scroll scroll" tabindex="0" role="region" aria-label="All ${vendors.length} antivirus vendors">${table}</div>
    <p class="vendor-table__count">${vendors.length} vendors · scroll to see all</p>
  </div>`;
  }
  return `<div class="vendor-table">
    <div class="vendor-table__summary">${summary}</div>
    ${table}
    ${more}
  </div>`;
}

/** Wires every "Show all vendors" toggle inside `root`. Safe to call repeatedly. */
export function bindVendorTables(root: ParentNode): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action="toggle-vendors"]:not([data-bound])')) {
    button.dataset.bound = 'true';
    const total = button.closest('.vendor-table')!.querySelectorAll('.vendor-table__row').length;
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      const limit = Number(button.dataset.limit);
      button.closest('.vendor-table')!.querySelectorAll<HTMLElement>('.vendor-table__row').forEach((row, index) => {
        row.hidden = expanded && index >= limit;
      });
      button.setAttribute('aria-expanded', String(!expanded));
      button.textContent = expanded ? `Show all ${total} vendors` : 'Show fewer';
    });
  }
}
