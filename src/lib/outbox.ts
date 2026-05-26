// Generic offline outbox for non-chat actions (SOS, SML check-ins,
// incident report submits, etc.). Each call site adds a typed item;
// the drain hook (useOutboxDrain) replays them when the browser is
// back online, the tab regains visibility, or the page mounts.
//
// Why a SEPARATE outbox from features/chat/outbox.ts and
// features/chat/actionQueue.ts: chat's queues are deeply tied to the
// chat store and to media-blob IDB lookup. Refactoring them to share
// this generic version would be high-risk for low reward — chat is
// stable and we'd rather not touch it. Two outboxes is acceptable.
//
// Why localStorage over IndexedDB: queue is tiny (a few pending
// actions max). Sync API keeps call sites simple. Media blobs already
// have their own IDB layer for chat; if we ever queue media-laden
// posts offline we'll reuse that.
//
// Per-user keyed so a shared device doesn't replay one user's queue
// into the other's session.

import { dispatchSosLog } from "./outbox/sos";
import { dispatchSmlStart, dispatchSmlConfirm, dispatchSmlCancel } from "./outbox/sml";
import { dispatchPostCreate } from "./outbox/post";

const KEY_PREFIX = "peja:outbox:v1:";
const MAX_ITEMS = 200;
export const MAX_AUTO_ATTEMPTS = 5;

// Common fields shared by every queued item. Each `kind` extends this
// with its own payload shape. Add a new kind here AND in
// runOutboxItem() below — the union is exhaustively switched so TS
// flags missing branches.
interface OutboxItemBase {
  id: string;
  queued_at: number;
  attempts: number;
  last_error: string | null;
}

// Discriminated union of every outbox action. EXTEND HERE when wiring
// a new flow. Until at least one kind exists the union is `never`,
// which is fine — call sites can't dispatch anything yet.
export type OutboxItem =
  | (OutboxItemBase & { kind: "sos-log"; payload: SosLogPayload })
  | (OutboxItemBase & { kind: "sml-start"; payload: SmlStartPayload })
  | (OutboxItemBase & { kind: "sml-confirm"; payload: SmlConfirmPayload })
  | (OutboxItemBase & { kind: "sml-cancel"; payload: SmlCancelPayload })
  | (OutboxItemBase & { kind: "post-create"; payload: PostCreatePayload });

// Per-kind payload shapes. Replace `unknown` with the real shape when
// wiring each kind. The outbox lib doesn't import from the call
// sites — each handler module owns its concrete type.

// SOS triggered while offline. Carries enough state to recreate the
// sos_alerts row + run the fan-out (email, nearby push) once the
// drain fires. SMS to emergency contacts already went out via the
// device's native SMS at the moment of press — no need to repeat it
// here, just record what happened.
export interface SosLogPayload {
  user_id: string;
  // ISO timestamp when the user actually pressed SOS. We persist this
  // separately from the row's created_at so the alert reflects when
  // the user needed help, not when the drain happened to fire.
  triggered_at: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  tag: string | null;
  message: string | null;
  // Always null for offline triggers — voice note upload requires
  // network. Online-path SOS doesn't go through the outbox.
  voice_note_url: string | null;
  // Cached contact IDs that received the offline SMS. Used so the
  // fan-out doesn't double-notify them via in-app/push when it runs.
  contact_ids: string[];
}

// SML "start a check-in" queued while offline. Mirrors the request
// body of /api/checkin/start. The server validates contacts + uniqueness
// of active check-ins at drain time — so if the user started one
// online in another session in the meantime, the drain will surface
// the error and the item retries until the cap.
export interface SmlStartPayload {
  contactIds: string[];
  intervalMinutes: number;
  triggered_at: string;
}

// SML "I'm OK, reset the timer" queued while offline. Carries the
// location captured at confirm-time so the contacts see where the
// user was when they checked in.
export interface SmlConfirmPayload {
  latitude: number | null;
  longitude: number | null;
  triggered_at: string;
}

// SML "stop sharing" queued while offline. No payload — the cancel
// route operates on the user's active check-in regardless.
export interface SmlCancelPayload {
  triggered_at: string;
}

// Post (incident report) drafted while offline. Media blobs live in
// the IDB store (lib/postDraftBlobs) keyed by draft_id + media_id —
// the payload only carries the metadata to look them up, never the
// blobs themselves (localStorage can't hold them efficiently).
//
// When the drain fires, dispatchPostCreate reads each blob back,
// uploads it (no compression in the offline path — compression is
// for the live UX; replays prioritize getting the post up), inserts
// the posts row, then post_media + post_tags. Best-effort cleanup
// of the IDB blobs happens after a successful insert.
export interface PostCreatePayload {
  user_id: string;
  draft_id: string;
  category: string;
  comment: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  country_code: string | null;
  is_anonymous: boolean;
  is_sensitive: boolean;
  tags: string[];
  media: Array<{
    media_id: string;
    type: "photo" | "video";
    mime_type: string;
    file_name: string;
  }>;
  triggered_at: string;
}

// ===== Storage =====

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
    // Light shape check — drop anything that doesn't at least look
    // like an OutboxItem. Full per-kind validation happens in the
    // handler when the item is replayed.
    return parsed.filter(
      (i): i is OutboxItem =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as { id?: unknown }).id === "string" &&
        typeof (i as { kind?: unknown }).kind === "string",
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
  } catch {
    // localStorage can throw on quota / private-browsing — swallow,
    // the item just won't survive a reload.
  }
}

export function addToOutbox(userId: string, item: OutboxItem): void {
  const items = readOutbox(userId);
  // Dedupe by id so a double-tap or React StrictMode double-invoke
  // doesn't enqueue twice.
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
  patch: Partial<OutboxItemBase>,
): void {
  const items = readOutbox(userId).map((i) =>
    i.id === id ? ({ ...i, ...patch } as OutboxItem) : i,
  );
  writeOutbox(userId, items);
}

export function clearOutbox(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {}
}

// ===== Dispatcher =====

/**
 * Replay a single queued item. Throws on failure so the drain bumps
 * attempts. Each kind delegates to its own handler module (lib/outbox/*)
 * — that way the kind handlers can import whatever they need (Supabase
 * client, fetch helpers, etc.) without polluting this lib.
 */
export async function runOutboxItem(item: OutboxItem): Promise<void> {
  switch (item.kind) {
    case "sos-log":
      return dispatchSosLog(item.payload);
    case "sml-start":
      return dispatchSmlStart(item.payload);
    case "sml-confirm":
      return dispatchSmlConfirm(item.payload);
    case "sml-cancel":
      return dispatchSmlCancel(item.payload);
    case "post-create":
      return dispatchPostCreate(item.payload);
    default: {
      // Exhaustiveness check — adding a new kind without a case here
      // produces a TS error.
      const _exhaustive: never = item;
      throw new Error(`Unknown outbox kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Caller wants to perform an action. If we're online, try it now and
 * fall back to queuing on failure. If we're offline, queue immediately
 * without attempting the network. Either way the action eventually
 * lands (next reconnect / drain) or expires the retry cap.
 *
 * NOTE: caller is responsible for any optimistic UI patch BEFORE
 * calling this — same pattern as chat's actionQueue.dispatchOrQueue.
 * On failure, the optimistic patch should be left in place; the user
 * sees a normal-looking result and the drain reconciles silently.
 */
export async function dispatchOrQueue(
  userId: string,
  item: OutboxItem,
): Promise<void> {
  const offline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    addToOutbox(userId, item);
    return;
  }
  try {
    await runOutboxItem(item);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addToOutbox(userId, { ...item, last_error: msg });
  }
}

// ===== Helpers =====

export function newOutboxId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
