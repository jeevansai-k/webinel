/**
 * User-facing scan errors. Raw VirusTotal errors are never shown; every failure
 * is mapped to one of these codes with a fixed, friendly message.
 */
import type { VirusTotalLookupStatus } from './verdict';

export type ScanErrorCode =
  | 'missing-key'
  | 'invalid-key'
  | 'forbidden'
  | 'rate-limited'
  | 'offline'
  | 'invalid-url'
  | 'file-too-large'
  | 'unsupported-file'
  | 'consent-required'
  | 'not-found'
  | 'server-error'
  | 'timeout'
  | 'cancelled'
  | 'interrupted';

export type ScanErrorAction = 'open-settings' | 'retry' | null;

export interface ScanErrorInfo {
  code: ScanErrorCode;
  title: string;
  message: string;
  action: ScanErrorAction;
}

const ERRORS: Record<ScanErrorCode, Omit<ScanErrorInfo, 'code'>> = {
  'missing-key': {
    title: 'VirusTotal API key required.',
    message: 'Add your free VirusTotal API key in Settings to scan links and files. It stays on this device.',
    action: 'open-settings',
  },
  'invalid-key': {
    title: 'VirusTotal rejected the API key.',
    message: 'Check the key in Settings — it may have been mistyped or revoked.',
    action: 'open-settings',
  },
  forbidden: {
    title: 'This key cannot use that feature.',
    message: 'VirusTotal refused the request for this API key. Some features need a different key type.',
    action: 'open-settings',
  },
  'rate-limited': {
    title: 'Daily API limit reached.',
    message:
      'Free VirusTotal keys allow 4 requests per minute and 500 per day. Wait a minute and try again; if it keeps happening, the daily quota resets at 00:00 UTC.',
    action: 'retry',
  },
  offline: {
    title: 'You appear to be offline.',
    message: 'VirusTotal could not be reached and there is no cached result for this item. Webinel never shows a fresh result it did not receive.',
    action: 'retry',
  },
  'invalid-url': {
    title: 'That is not a valid web address.',
    message: 'Enter a full http:// or https:// link, for example https://example.com/login.',
    action: null,
  },
  'file-too-large': {
    title: 'File is larger than 32 MB.',
    message: 'VirusTotal accepts files up to 32 MB. Nothing was uploaded.',
    action: null,
  },
  'unsupported-file': {
    title: 'This file type is not supported.',
    message: 'Supported: PDF, DOCX, XLSX, ZIP, EXE, APK, PNG, JPG, GIF and TXT.',
    action: null,
  },
  'consent-required': {
    title: 'Upload needs your permission.',
    message: 'Webinel never uploads a file unless you choose to.',
    action: null,
  },
  'not-found': {
    title: 'VirusTotal has no record of this yet.',
    message: 'Try again in a moment — new analyses can take a little while to appear.',
    action: 'retry',
  },
  'server-error': {
    title: 'VirusTotal had a problem.',
    message: 'The service returned an unexpected error. Please try again shortly.',
    action: 'retry',
  },
  timeout: {
    title: 'VirusTotal is taking too long.',
    message: 'No answer arrived within 6 seconds. Try again, or run Advanced Analysis for a complete scan without a time limit.',
    action: 'retry',
  },
  cancelled: {
    title: 'Analysis cancelled.',
    message: 'No further requests were made.',
    action: 'retry',
  },
  interrupted: {
    title: 'Analysis was interrupted.',
    message: 'The browser stopped Webinel’s background worker. Start the analysis again.',
    action: 'retry',
  },
};

export function describeScanError(code: ScanErrorCode): ScanErrorInfo {
  return { code, ...ERRORS[code] };
}

export function errorCodeForStatus(status: VirusTotalLookupStatus): ScanErrorCode {
  switch (status) {
    case 'no-key':
      return 'missing-key';
    case 'invalid-key':
      return 'invalid-key';
    case 'forbidden':
      return 'forbidden';
    case 'rate-limited':
    case 'quota-exceeded':
      return 'rate-limited';
    case 'unreachable':
      return 'offline';
    case 'not-found':
      return 'not-found';
    default:
      return 'server-error';
  }
}

export class ScanError extends Error {
  constructor(readonly code: ScanErrorCode) {
    super(ERRORS[code].title);
    this.name = 'ScanError';
  }

  get info(): ScanErrorInfo {
    return describeScanError(this.code);
  }
}

export function toScanErrorInfo(error: unknown): ScanErrorInfo {
  if (error instanceof ScanError) return error.info;
  if (error instanceof DOMException && error.name === 'AbortError') return describeScanError('cancelled');
  return describeScanError('server-error');
}
