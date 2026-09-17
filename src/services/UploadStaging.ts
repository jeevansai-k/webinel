/**
 * Hands a user-approved file from the popup to the background worker.
 * Runtime messages cannot carry large binary data, so the Blob is parked in the
 * extension's own IndexedDB and removed as soon as the upload starts (or is
 * abandoned). Content scripts cannot reach this database.
 */
export interface UploadStaging {
  put(blob: Blob): Promise<string>;
  take(id: string): Promise<Blob | null>;
  clear(): Promise<void>;
}

const DB_NAME = 'webinel-uploads';
const STORE = 'files';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  const db = await promisify(open);
  try {
    return await promisify(run(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

export const indexedDbStaging: UploadStaging = {
  async put(blob) {
    const id = crypto.randomUUID();
    await withStore('readwrite', (store) => store.put(blob, id));
    return id;
  },
  async take(id) {
    const blob = await withStore<Blob | undefined>('readonly', (store) => store.get(id));
    await withStore('readwrite', (store) => store.delete(id));
    return blob ?? null;
  },
  async clear() {
    await withStore('readwrite', (store) => store.clear());
  },
};

/** In-memory staging for tests and previews. */
export function memoryStaging(): UploadStaging & { size(): number } {
  const blobs = new Map<string, Blob>();
  return {
    async put(blob) {
      const id = crypto.randomUUID();
      blobs.set(id, blob);
      return id;
    },
    async take(id) {
      const blob = blobs.get(id) ?? null;
      blobs.delete(id);
      return blob;
    },
    async clear() {
      blobs.clear();
    },
    size: () => blobs.size,
  };
}
