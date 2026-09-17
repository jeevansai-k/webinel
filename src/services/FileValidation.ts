/** Local file checks shared by the popup and the background. Pure functions. */
import { MAX_FILE_BYTES, SUPPORTED_FILE_TYPES } from '../shared/config';
import { ScanError } from '../shared/scanErrors';

export function fileExtension(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1]!.toLowerCase() : '';
}

export function isSupportedFile(fileName: string): boolean {
  return fileExtension(fileName) in SUPPORTED_FILE_TYPES;
}

/** Oversized or unsupported files never leave the device. */
export function validateFile(file: { fileName: string; size: number }): void {
  if (file.size > MAX_FILE_BYTES) throw new ScanError('file-too-large');
  if (!isSupportedFile(file.fileName)) throw new ScanError('unsupported-file');
}

export function mimeTypeFor(fileName: string, reported: string | null | undefined): string | null {
  return reported || SUPPORTED_FILE_TYPES[fileExtension(fileName)] || null;
}

/** `accept` attribute for file inputs. */
export const FILE_INPUT_ACCEPT = Object.keys(SUPPORTED_FILE_TYPES)
  .map((extension) => `.${extension}`)
  .join(',');
