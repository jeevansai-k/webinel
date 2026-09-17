/** SHA-256 helpers built on Web Crypto (available in pages, workers and Node ≥ 19). */

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return toHex(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

/** VirusTotal URL identifier: unpadded base64url of the URL. */
export function toVirusTotalUrlId(url: string): string {
  const bytes = new TextEncoder().encode(url);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
