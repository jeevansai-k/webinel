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

/** The file could not be passed between the popup and the background. */
export class StagingError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'StagingError';
  }
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

async function openDb(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  return promisify(open);
}

/**
 * Runs one transaction and resolves only after it has committed. Any IndexedDB
 * failure (including Firefox aborting the transaction) becomes a StagingError,
 * never a bare AbortError that could be mistaken for the user cancelling.
 */
async function withTransaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const transaction = db.transaction(STORE, mode);
    const done = transactionDone(transaction);
    const result = await run(transaction.objectStore(STORE));
    await done;
    return result;
  } catch (error) {
    throw error instanceof StagingError ? error : new StagingError('Could not stage the file for upload.', error);
  } finally {
    db?.close();
  }
}

export const indexedDbStaging: UploadStaging = {
  async put(blob) {
    const id = crypto.randomUUID();
    await withTransaction('readwrite', (store) => promisify(store.put(blob, id)));
    return id;
  },
  async take(id) {
    // Read and delete in one transaction, then copy the bytes out. A Blob that is
    // still backed by an IndexedDB record can become unreadable once that record is
    // deleted (Firefox), so the background only ever handles an in-memory copy.
    const stored = await withTransaction<Blob | undefined>('readwrite', async (store) => {
      const blob = await promisify<Blob | undefined>(store.get(id));
      store.delete(id);
      return blob;
    });
    if (!stored) return null;
    try {
      return new Blob([await stored.arrayBuffer()], { type: stored.type });
    } catch (error) {
      throw new StagingError('The staged file could not be read.', error);
    }
  },
  async clear() {
    await withTransaction('readwrite', (store) => promisify(store.clear()).then(() => undefined));
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
