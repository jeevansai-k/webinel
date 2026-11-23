import { describe, expect, it } from 'vitest';
import { StagingError } from '../services/UploadStaging';
import { ScanError, toScanErrorInfo } from './scanErrors';

describe('toScanErrorInfo', () => {
  it('never turns a stray AbortError into "Analysis cancelled"', () => {
    const info = toScanErrorInfo(new DOMException('The operation was aborted.', 'AbortError'));
    expect(info.code).toBe('interrupted');
    expect(info.title).not.toMatch(/cancel/i);
  });

  it('explains a failed popup → background file handoff', () => {
    expect(toScanErrorInfo(new StagingError('IndexedDB transaction aborted')).code).toBe('upload-handoff');
  });

  it('keeps explicit scan errors as they are', () => {
    expect(toScanErrorInfo(new ScanError('cancelled')).code).toBe('cancelled');
    expect(toScanErrorInfo(new Error('boom')).code).toBe('server-error');
  });
});
