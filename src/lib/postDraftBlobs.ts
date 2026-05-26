// IndexedDB store for media blobs attached to offline post drafts.
//
// Why a separate DB from features/chat/mediaBlobs: keeping the post
// draft store independent means we can clear it without touching
// chat's queue, and a future schema bump on either side doesn't risk
// the other. Same micro-API surface as the chat one — open, put,
// get, deleteForDraft — so anyone familiar with one can read the
// other in seconds.
//
// Keys: composite "{draftId}:{mediaId}". One queued post-create can
// carry multiple media (album of photos / mixed photo+video), each
// stored under one IDB key.

const DB_NAME = "peja-post-drafts";
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

function blobKey(draftId: string, mediaId: string): string {
  return `${draftId}:${mediaId}`;
}

export async function putDraftBlob(
  draftId: string,
  mediaId: string,
  blob: Blob,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, blobKey(draftId, mediaId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getDraftBlob(
  draftId: string,
  mediaId: string,
): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(blobKey(draftId, mediaId));
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteDraftBlobs(draftId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const key = String(cursor.key);
      if (key.startsWith(`${draftId}:`)) {
        cursor.delete();
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
