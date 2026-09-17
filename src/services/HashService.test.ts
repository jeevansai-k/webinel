import { describe, expect, it } from 'vitest';
import { isSha256, sha256OfBlob, sha256OfText } from './HashService';

describe('HashService', () => {
  it('hashes text with SHA-256 (known vectors)', async () => {
    expect(await sha256OfText('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256OfText('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes files locally, byte for byte', async () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);
    expect(await sha256OfBlob(new Blob([bytes]))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('recognises SHA-256 digests', () => {
    expect(isSha256('A'.repeat(64))).toBe(true);
    expect(isSha256('a'.repeat(63))).toBe(false);
    expect(isSha256('g'.repeat(64))).toBe(false);
  });
});
