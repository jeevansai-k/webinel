/** URL validation shared by the popup and the background. Pure functions. */
import { ScanError } from '../shared/scanErrors';
import { isIpAddress } from '../utils/domain';
import { getHost, normalizeUrl } from '../utils/url';

/** Normalizes and validates a URL before anything is sent to VirusTotal. */
export function requireUrl(raw: string): string {
  const url = normalizeUrl(raw);
  const host = url ? getHost(url) : null;
  const plausibleHost = host !== null && (host.includes('.') || isIpAddress(host) || host === 'localhost');
  if (!url || !plausibleHost) throw new ScanError('invalid-url');
  return url;
}
