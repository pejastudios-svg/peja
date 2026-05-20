// Outbox for v2 chat. Pending sends are persisted to localStorage so they
// survive a page reload, a tab close, or a crashed network attempt mid-send.
//
// Flow:
//   1. useSendMessage adds the item to the outbox before attempting the
//      network call. The optimistic message also goes into the store.
//   2. If the send succeeds, the item is removed from the outbox.
//   3. If the send fails (no network, server error), the item stays in the
//      outbox and the store message flips to "failed".
//   4. On reconnect (online event, visibility change to "visible", app
//      foreground), useOutboxDrain replays the outbox in FIFO order.
//
// We pick localStorage over IndexedDB intentionally:
//   - The queue is tiny (a few unsent messages, max). Sync API is fine.
//   - IDB's async API complicates the call sites with no real benefit at
//     this scale.
//   - Volume cap below prevents pathological growth.
//
// If we ever need attachments/media in the queue, IndexedDB becomes the
// right tool — Phase 3 problem.
//
// NOTE: per-user partitioning. The key includes the user id so a phone
// shared between two accounts doesn't replay one user's queue into the
// other's session.
import type { OutboxItem } from "./types";

const KEY_PREFIX = "peja:chat:outbox:v1:";
const MAX_ITEMS = 200; // Safety cap.

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function readOutbox(userId: string): OutboxItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (i): i is OutboxItem =>
        typeof i === "object" &&
        i !== null &&
        typeof i.id === "string" &&
        typeof i.conversation_id === "string" &&
        typeof i.sender_id === "string" &&
        typeof i.content === "string"
    );
  } catch {
    return [];
  }
}

function writeOutbox(userId: string, items: OutboxItem[]): void {
  if (typeof window === "undefined") return;
  try {
    const capped = items.slice(-MAX_ITEMS);
    window.localStorage.setItem(keyFor(userId), JSON.stringify(capped));
  } catch {}
}

export function addToOutbox(userId: string, item: OutboxItem): void {
  const items = readOutbox(userId);
  // Dedup by id — protects against double-add from React StrictMode
  // double-invoke or accidental re-send of the same UUID.
  if (items.some((i) => i.id === item.id)) return;
  items.push(item);
  writeOutbox(userId, items);
}

export function removeFromOutbox(userId: string, id: string): void {
  const items = readOutbox(userId).filter((i) => i.id !== id);
  writeOutbox(userId, items);
}

export function patchOutboxItem(
  userId: string,
  id: string,
  patch: Partial<OutboxItem>
): void {
  const items = readOutbox(userId).map((i) =>
    i.id === id ? { ...i, ...patch } : i
  );
  writeOutbox(userId, items);
}

export function clearOutbox(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {}
}
