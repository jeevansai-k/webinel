/** URL helpers shared by every context. Pure functions — no browser APIs. */

const SCANNABLE_PROTOCOLS = new Set(['http:', 'https:']);
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_eid',
]);

/** Parses a string into a URL, returning null instead of throwing. */
export function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/** True when Webinel can meaningfully evaluate the URL (http/https only). */
export function isScannableUrl(raw: string): boolean {
  const url = parseUrl(raw);
  return url !== null && SCANNABLE_PROTOCOLS.has(url.protocol) && url.hostname.length > 0;
}

/**
 * Canonical form used for cache keys and VirusTotal lookups:
 * lower-case scheme/host, no default port, no fragment, no tracking params,
 * no trailing dot on the host, "/" as the minimum path.
 * Returns null for anything that is not an http(s) URL.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  // "example.com:8443/x" and "localhost:3000" are host:port, not a scheme: a colon
  // followed by a digit never starts a URL scheme's body for the schemes we accept.
  const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  const url = parseUrl(candidate);
  if (!url || !SCANNABLE_PROTOCOLS.has(url.protocol) || !url.hostname) return null;

  url.hash = '';
  url.hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  if (url.search === '?') url.search = '';
  return url.toString();
}

/** Lower-case hostname without a trailing dot, or null for unparsable input. */
export function getHost(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url || !url.hostname) return null;
  return url.hostname.replace(/\.$/, '').toLowerCase();
}

/** Extracts http(s) URLs from free text (documents, clipboard). Deduplicated, order preserved. */
export function extractUrlsFromText(text: string, limit = 200): string[] {
  const matches = text.match(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi) ?? [];
  const unique = new Set<string>();
  for (const match of matches) {
    const cleaned = match.replace(/[.,;:!?]+$/, '');
    const normalized = normalizeUrl(cleaned);
    if (normalized) unique.add(normalized);
    if (unique.size >= limit) break;
  }
  return [...unique];
}

/** Shortens a URL for display without leaking query strings into the UI. */
export function displayUrl(raw: string, maxLength = 48): string {
  const url = parseUrl(raw);
  const text = url ? `${url.hostname}${url.pathname === '/' ? '' : url.pathname}` : raw;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
