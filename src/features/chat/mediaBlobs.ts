// Local IndexedDB store for media blobs queued in the chat outbox.
//
// Why IDB (not localStorage):
//   • localStorage values are strings only — File / Blob objects can't be
//     stored there without base64-encoding the whole thing, which inflates
//     memory ~33%, blocks the main thread on read, and runs into the ~5MB
//     per-origin quota fast.
//   • IDB stores Blobs natively, asynchronously, and has a much larger
//     quota (browser-controlled, typically hundreds of MB or more).
//
// Keys: composite "{messageId}:{attachmentId}" → Blob. One outbox message
// can carry multiple attachments (album of photos, etc.); each occupies
// one IDB key.
//
// This module is intentionally tiny — no library. The native IDB API is
// verbose but the surface we use is small (open, put, get, getAllByPrefix,
// delete), so a wrapper is a clearer dependency boundary than pulling in
// idb-keyval or Dexie.

const DB_NAME = "peja-chat-v2";
const DB_VERSION = 1;
const STORE = "media-blobs";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function blobKey(messageId: string, attachmentId: string): string {
  return `${messageId}:${attachmentId}`;
}

export async function putBlob(
  messageId: string,
  attachmentId: string,
  blob: Blob
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, blobKey(messageId, attachmentId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getBlob(
  messageId: string,
  attachmentId: string
): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(blobKey(messageId, attachmentId));
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function removeBlobsForMessage(messageId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    // No prefix query in IDB without an index — iterate keys and delete
    // matches. Acceptable: the store stays small (a few queued blobs at
    // worst) so the linear scan is cheap.
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const key = String(cursor.key);
      if (key.startsWith(`${messageId}:`)) {
        cursor.delete();
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
