/**
 * Stores the user's VirusTotal API key on this device only.
 *
 * - Lives in chrome.storage.local (never sync), encrypted with AES-GCM.
 * - The AES key is non-extractable and kept in the extension origin's IndexedDB,
 *   so the ciphertext alone is useless if storage is copied.
 * - Only the background service worker reads the plaintext; UI contexts can
 *   only ask whether a key is configured.
 */
import { LocalStore } from './LocalStore';

interface EncryptedSecret {
  iv: number[];
  data: number[];
}

export interface CryptoKeyProvider {
  getKey(): Promise<CryptoKey>;
}

const DB_NAME = 'webinel-keys';
const DB_STORE = 'keys';
const KEY_ID = 'virustotal-secret-key';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Default provider: a non-extractable AES-GCM key persisted in IndexedDB. */
export class IndexedDbKeyProvider implements CryptoKeyProvider {
  private cached: Promise<CryptoKey> | null = null;

  getKey(): Promise<CryptoKey> {
    this.cached ??= this.loadOrCreate();
    return this.cached;
  }

  private async loadOrCreate(): Promise<CryptoKey> {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
    const db = await requestToPromise(open);
    try {
      const existing = await requestToPromise<CryptoKey | undefined>(
        db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(KEY_ID),
      );
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await requestToPromise(db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(key, KEY_ID));
      return key;
    } finally {
      db.close();
    }
  }
}

/** VirusTotal keys are 64 lowercase hex characters. */
export function isPlausibleApiKey(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value.trim());
}

export class SecretStore {
  private readonly store = new LocalStore<EncryptedSecret | null>('vt.secret', () => null);

  constructor(private readonly keyProvider: CryptoKeyProvider = new IndexedDbKeyProvider()) {}

  async hasApiKey(): Promise<boolean> {
    return (await this.store.get()) !== null;
  }

  async saveApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (!isPlausibleApiKey(trimmed)) throw new Error('A VirusTotal API key is 64 hexadecimal characters.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await this.keyProvider.getKey(),
      new TextEncoder().encode(trimmed),
    );
    await this.store.set({ iv: [...iv], data: [...new Uint8Array(cipher)] });
  }

  /** Returns the plaintext key or null. Background-only. */
  async readApiKey(): Promise<string | null> {
    const secret = await this.store.get();
    if (!secret) return null;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(secret.iv) },
        await this.keyProvider.getKey(),
        new Uint8Array(secret.data),
      );
      return new TextDecoder().decode(plain);
    } catch {
      // Key material lost (e.g. IndexedDB cleared): the ciphertext is unusable.
      await this.store.clear();
      return null;
    }
  }

  clearApiKey(): Promise<void> {
    return this.store.clear();
  }
}
