// Per-conversation thread snapshot cache (IndexedDB).
//
// Purpose: warm-start chats so opening one shows the LAST-KNOWN
// state instantly, while fetchThread / realtime catch up in the
// background. Without this the user sees a brief empty skeleton
// every time they open a chat — even though we usually have the
// data already.
//
// Strategy:
//   • Cache the most-recent N=100 messages per conversation under
//     the key `${userId}:${conversationId}`.
//   • Restore on mount BEFORE the fetchThread network round-trip
//     resolves. Mark the thread hydrated so the regular render
//     path kicks in immediately.
//   • Overwrite on fetchThread success so the cache stays close
//     to the server. Realtime additions are not written eagerly
//     — the next open's fetchThread refreshes whatever was missed.
//   • Drop the entry when the user deletes the chat.
//
// We use a dedicated DB (peja-chat-v2-cache) rather than reusing
// the media-blobs DB so a future schema change here doesn't risk
// breaking outbox blobs.

import type { ChatMessage } from "./types";

const DB_NAME = "peja-chat-v2-cache";
const DB_VERSION = 1;
const STORE = "thread-snapshots";

// Trim per-conversation snapshots to the most recent N messages
// before persisting. Keeps the IDB payload bounded even for
// busy chats.
const MAX_MESSAGES_PER_CONV = 100;

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

function cacheKey(userId: string, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

interface ThreadSnapshot {
  // Schema version on the row itself so a future-format change can
  // be migrated or invalidated without nuking IDB.
  v: 1;
  cached_at: string;
  messages: ChatMessage[];
}

export async function getCachedThread(
  userId: string,
  conversationId: string
): Promise<ChatMessage[] | null> {
  try {
    const db = await openDb();
    return await new Promise<ChatMessage[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(cacheKey(userId, conversationId));
      req.onsuccess = () => {
        const val = req.result as ThreadSnapshot | undefined;
        if (!val || val.v !== 1 || !Array.isArray(val.messages)) {
          resolve(null);
          return;
        }
        resolve(val.messages);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // IDB unavailable or transient error — caller treats null as
    // "no cache, render skeleton until fetchThread lands".
    return null;
  }
}

export async function saveCachedThread(
  userId: string,
  conversationId: string,
  messages: ChatMessage[]
): Promise<void> {
  try {
    const db = await openDb();
    // Keep only the tail (newest N). The thread renders chronologically
    // so the LAST N elements of the input array are the most recent.
    const trimmed =
      messages.length > MAX_MESSAGES_PER_CONV
        ? messages.slice(messages.length - MAX_MESSAGES_PER_CONV)
        : messages;
    const snapshot: ThreadSnapshot = {
      v: 1,
      cached_at: new Date().toISOString(),
      messages: trimmed,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(snapshot, cacheKey(userId, conversationId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Swallow — caching is a perf optimisation, not correctness.
  }
}

export async function deleteCachedThread(
  userId: string,
  conversationId: string
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(cacheKey(userId, conversationId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {}
}
