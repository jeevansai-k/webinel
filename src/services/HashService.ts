/**
 * Local hashing. Files are hashed on the device; only the digest is ever sent
 * to VirusTotal for a lookup.
 */
import { sha256Hex } from '../utils/hash';

export async function sha256OfBlob(blob: Blob): Promise<string> {
  return sha256Hex(await blob.arrayBuffer());
}

export function sha256OfText(text: string): Promise<string> {
  return sha256Hex(text);
}

export function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
