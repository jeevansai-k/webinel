/**
 * Domain parsing without the full Public Suffix List.
 * The multi-part suffix list is intentionally small; results are an approximation
 * used only for heuristics, never for security-critical equality checks.
 */

const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'co.nz', 'org.nz', 'co.za', 'org.za',
  'com.cn', 'net.cn', 'org.cn', 'com.hk', 'com.sg', 'com.tw',
  'com.mx', 'com.ar', 'com.tr', 'co.kr', 'or.kr', 'com.my', 'com.ph',
  'github.io', 'gitlab.io', 'herokuapp.com', 'vercel.app', 'netlify.app',
  'pages.dev', 'web.app', 'firebaseapp.com', 'blogspot.com', 'azurewebsites.net',
]);

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isIpAddress(host: string): boolean {
  if (host.startsWith('[') || host.includes(':')) return true;
  const match = IPV4_PATTERN.exec(host);
  return match !== null && match.slice(1).every((part) => Number(part) <= 255);
}

/** "login.paypal.com.evil.co.uk" → "evil.co.uk" */
export function getRegistrableDomain(host: string): string {
  if (isIpAddress(host)) return host;
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  const take = MULTI_PART_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** "evil.co.uk" → "evil"; the label a user reads as the "site name". */
export function getDomainLabel(host: string): string {
  const registrable = getRegistrableDomain(host);
  return registrable.split('.')[0] ?? registrable;
}

export function getTld(host: string): string {
  const labels = host.toLowerCase().split('.');
  return labels[labels.length - 1] ?? '';
}

/** Subdomain labels in front of the registrable domain. */
export function getSubdomainLabels(host: string): string[] {
  const registrable = getRegistrableDomain(host);
  if (host === registrable) return [];
  return host.slice(0, host.length - registrable.length - 1).split('.').filter(Boolean);
}

/** True when `host` equals `domain` or is one of its subdomains. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase().replace(/^\*\./, '');
  return h === d || h.endsWith(`.${d}`);
}

/** Classic edit distance, used for look-alike brand detection. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}
