/**
 * Minimal logger that scrubs anything resembling a VirusTotal API key
 * (64 hex chars) before it can reach the console.
 */
const SECRET_PATTERN = /\b[a-f0-9]{64}\b/gi;

function scrub(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_PATTERN, '[redacted]');
  if (value instanceof Error) return scrub(value.message);
  return value;
}

export const logger = {
  warn: (...args: unknown[]) => console.warn('[Webinel]', ...args.map(scrub)),
  error: (...args: unknown[]) => console.error('[Webinel]', ...args.map(scrub)),
};
