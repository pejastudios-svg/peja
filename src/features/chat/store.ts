// Zustand store for the v2 messaging system. Single source of truth for:
//   - The conversation list (summaries: who, last preview, unread, seen).
//   - Per-conversation message threads (the actual messages).
//   - Outbox state for messages still in flight.
//
// Components subscribe via narrow selectors so a change to one thread
// doesn't re-render the entire list, and vice versa.
//
// Realtime + send flows live in sibling modules and dispatch through this
// store's actions — they never write directly to underlying state.

import { create } from "zustand";
import type {
  ChatConversationSummary,
  ChatMessage,
  ChatThread,
  DeliveryStatus,
  MessageReaction,
} from "./types";

interface ChatStoreState {
  // Identity. Set once on app boot from AuthContext. All sender-side
  // logic (delivery_status, unread tallies) reads this.
  currentUserId: string | null;

  // Has the conversation list been fetched at least once this session?
  // Distinguishes "no conversations" from "haven't asked yet".
  conversationsHydrated: boolean;

  // Conversation list keyed by id for O(1) lookups, plus a sorted id
  // array maintained alongside so render order is deterministic without
  // re-sorting on every read.
  conversationsById: Record<string, ChatConversationSummary>;
  conversationOrder: string[]; // sorted: most-recent last_message_at first

  // Per-conversation threads.
  threadsByConversation: Record<string, ChatThread>;

  // Timestamp (ms) of the most recent local clearThread for each
  // conversation. Used as a horizon: setThread / upsertMessage discard
  // any incoming message whose created_at predates this, which protects
  // against in-flight fetches that started before the clear and resolve
  // after it (their result reflects the pre-delete-row state and would
  // otherwise repopulate the cleared thread). Session-scoped — the
  // server-side message_deletions rows take over across reloads.
  clearedAtByConversation: Record<string, number>;

  // Bumped to Date.now() every time the realtime channel transitions to
  // SUBSCRIBED. Components that need to catch up after a disconnect watch
  // this in their deps and refetch when it changes. Supabase Realtime
  // doesn't replay events that fired while disconnected, so on flaky
  // networks every drop = a gap unless we explicitly refetch on reconnect.
  lastConnectedAt: number | null;

  // The conversation the user is *currently looking at*. The chat thread
  // page sets it on mount and clears it on unmount. The realtime layer
  // reads this to decide whether an incoming message should bump the
  // unread badge — if the user is actively viewing the thread, they
  // already saw the message, so the badge stays at 0.
  activeConversationId: string | null;

  // Timestamp (ms) of the most recent local `clearUnread` for each
  // conversation. The server-side `markConversationRead` UPDATE takes
  // ~100-500ms to propagate; in that window, any refetch of the
  // conversation list returns stale `unread_count > 0` for the conv we
  // just cleared. setConversations honors this grace window and refuses
  // to bump our local 0 back up if the clear was recent. Treats it as
  // "we know better than the DB right now."
  recentlyClearedAt: Record<string, number>;

  // Persisted drafts per conversation. The thread page reads + writes
  // this so that typing a message, navigating away, then coming back
  // restores the draft as-is. Stored to localStorage on every change.
  draftsByConversation: Record<string, string>;

  // Set of user ids currently online (from Supabase Realtime Presence).
  // Powers the purple dot next to avatars. Stored as a plain record so
  // selectors can compare-by-reference and bail out cleanly.
  onlineUserIds: Record<string, true>;

  // Last-seen timestamp per user — populated client-side when a user
  // *transitions* from online to offline while we're watching. Cross-
  // session "last seen yesterday" requires server storage (deferred to a
  // small migration), so this only covers offline events observed this
  // session.
  lastSeenByUserId: Record<string, string>;

  // Who is currently typing or recording, per conversation. We store
  // the user's id, the activity kind, and the timestamp the event last
  // fired. Receivers expire entries after ~3s of no event (handled by
  // a setTimeout scheduled when the entry is written). Voice notes use
  // the same channel as typing because the receiver-side UI (header
  // subtitle + in-thread pulsing icon) is the same surface — only the
  // icon swaps.
  // Per-conversation map of typers, keyed by userId. A DM has at
  // most one entry; a group can have several at once. Each entry
  // carries the sender's name so consumers can render
  // "Jane is typing" / "Jane and Sam are typing" / "3 people typing"
  // without a separate lookup. Name is optional because old
  // broadcasts (pre-name) just carried user_id — receivers fall back
  // to a generic label in that case.
  typingByConversation: Record<
    string,
    Record<string, { kind: "typing" | "recording"; userName?: string; at: number }>
  >;

  // Live upload progress for in-flight media sends, keyed by message
  // id. Value is { fraction: 0..1, label: "Compressing photo…" | "…" }.
  // The bubble's circular progress ring reads this; useSendMessage
  // writes it as compression + upload tick. Cleared once the send
  // finalises (sent OR failed).
  uploadProgressById: Record<string, { fraction: number; label?: string } | undefined>;

  // === Identity actions ===
  setCurrentUserId: (userId: string | null) => void;
  setLastConnected: () => void;
  setActiveConversationId: (conversationId: string | null) => void;

  // === Conversation list actions ===
  setConversations: (conversations: ChatConversationSummary[]) => void;
  upsertConversation: (conv: ChatConversationSummary) => void;
  patchConversation: (
    conversationId: string,
    patch: Partial<ChatConversationSummary>
  ) => void;
  bumpConversation: (conversationId: string, preview: {
    last_message_text: string | null;
    last_message_at: string;
    last_message_sender_id: string;
  }) => void;
  // Drop a conversation from the list + tear down its thread. Used by
  // the "Delete chat" action — the conversation row stays in the DB
  // but the current user's view hides it. handleMessageInsert undoes
  // the hide the moment a new message arrives from the other side.
  removeConversation: (conversationId: string) => void;
  incrementUnread: (conversationId: string) => void;
  clearUnread: (conversationId: string) => void;
  markPreviewSeen: (conversationId: string) => void;

  // === Thread actions ===
  setThread: (conversationId: string, messages: ChatMessage[]) => void;
  // Replace a thread with empty, bypassing setThread's merge. Used by
  // "clear chat" — setThread([]) preserves any existing message newer
  // than the (empty) incoming horizon, which is every existing message.
  // We still keep pending-delivery sends so an in-flight outbox doesn't
  // get dropped mid-clear.
  clearThread: (conversationId: string) => void;
  // Prepend a page of OLDER messages to a thread. Used by the
  // "load older on scroll up" pagination. Deduped on id, sorted on
  // insert. Does NOT touch the `hydrated` / `fetchedAt` flags — the
  // thread is still hydrated, we're just extending into history.
  prependOlderMessages: (
    conversationId: string,
    older: ChatMessage[]
  ) => void;
  upsertMessage: (conversationId: string, message: ChatMessage) => void;
  patchMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<ChatMessage>
  ) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  setMessageStatus: (
    conversationId: string,
    messageId: string,
    status: DeliveryStatus
  ) => void;
  markThreadHydrated: (conversationId: string) => void;
  // === Reactions ===
  // Adds a single MessageReaction to the target message's reactions
  // array, deduped on id (idempotent against realtime echoes of our
  // own optimistic insert).
  addReaction: (
    conversationId: string,
    messageId: string,
    reaction: MessageReaction
  ) => void;
  // Removes a reaction. Pass `reactionId` for the precise row; pass
  // `match` (predicate) when we only know the optimistic temp id.
  removeReaction: (
    conversationId: string,
    messageId: string,
    matcher: { id?: string; userId?: string; emoji?: string }
  ) => void;
  // Atomic swap — remove every reaction belonging to `userId` AND
  // add `replacement` in a single setState. Used so that switching
  // emojis doesn't render two intermediate states (old gone → empty
  // gap → new appears) which made the badge flicker visibly.
  replaceMyReaction: (
    conversationId: string,
    messageId: string,
    userId: string,
    replacement: MessageReaction
  ) => void;

  // === Drafts ===
  setDraft: (conversationId: string, text: string) => void;
  clearDraft: (conversationId: string) => void;

  // === Presence ===
  setOnlinePresence: (onlineUserIds: Record<string, true>) => void;
  markUserOffline: (userId: string, at: string) => void;

  // === Typing / recording ===
  // Receiver-side: a typing OR recording broadcast came in for the
  // given user. Replaces any existing entry — only one activity per
  // conversation shown at a time. The `kind` field drives whether
  // the in-thread bubble shows a chat-bubble icon (typing) or a mic
  // icon (recording), and likewise the header subtitle text.
  // userName is optional — only newer broadcasts include it. Without
  // it, group typing falls back to "Someone is typing".
  setTyping: (
    conversationId: string,
    userId: string,
    kind?: "typing" | "recording",
    userName?: string,
  ) => void;
  // userId is optional: omitted = wipe ALL typers for this
  // conversation (used by channel-unsubscribe paths). Specified =
  // wipe just that one user (TTL expiry path).
  clearTyping: (conversationId: string, userId?: string) => void;

  // === Upload progress ===
  setUploadProgress: (
    messageId: string,
    progress: { fraction: number; label?: string }
  ) => void;
  clearUploadProgress: (messageId: string) => void;

  // === Maintenance ===
  // Clears everything. Called on signOut. Realtime channels are torn
  // down by the realtime layer separately.
  reset: () => void;
}

// Sort comparator extracted so it stays consistent everywhere the order
// changes — bumps, upserts, initial set.
function sortIds(
  byId: Record<string, ChatConversationSummary>,
  ids: string[]
): string[] {
  return [...ids].sort((aId, bId) => {
    const a = byId[aId];
    const b = byId[bId];
    const aPinned = !!a?.is_pinned;
    const bPinned = !!b?.is_pinned;
    // Pinned rows always sort to the top. Within pinned, the most
    // recently pinned wins; within unpinned, the most recent last
    // message wins.
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    if (aPinned && bPinned) {
      const ap = a?.pinned_at ? new Date(a.pinned_at).getTime() : 0;
      const bp = b?.pinned_at ? new Date(b.pinned_at).getTime() : 0;
      if (ap !== bp) return bp - ap;
    }
    const at = a?.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const bt = b?.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return bt - at;
  });
}

function emptyThread(conversationId: string): ChatThread {
  return { conversationId, messages: [], hydrated: false, fetchedAt: null };
}

// === Drafts persistence ===
// Single shared localStorage key. Drafts are small (one short string per
// conversation), so we read once at boot and write the full map on each
// change. Synchronous API keeps the store action simple.
const DRAFTS_KEY = "peja:chat:drafts:v1";

function loadDrafts(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function persistDrafts(drafts: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {}
}

// === Conversation list persistence ===
// Persists the conversation summaries (id, last message preview, unread,
// other_user info) so the /messages page can render the chat list
// offline. Without this, opening /messages cold-offline shows skeletons
// forever — `conversationsHydrated` is only flipped to true on a
// successful network refetch (see useChatInit), so an offline cold
// open never reaches that branch.
//
// Keyed per-user so a shared device doesn't leak chat lists across
// accounts.
const CONVERSATIONS_CACHE_PREFIX = "peja:chat:conversations:v1:";

function conversationsCacheKey(userId: string): string {
  return `${CONVERSATIONS_CACHE_PREFIX}${userId}`;
}

export function readConversationsCache(
  userId: string,
): ChatConversationSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(conversationsCacheKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.list)) return [];
    return parsed.list as ChatConversationSummary[];
  } catch {
    return [];
  }
}

export function persistConversationsCache(
  userId: string,
  list: ChatConversationSummary[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      conversationsCacheKey(userId),
      JSON.stringify({ list, cached_at: Date.now() }),
    );
  } catch {}
}

// === Typing-indicator timers ===
// Map of "conversationId|userId" → timeout handle. When a typing event
// fires, we (re)set a 3s timer that wipes the entry. Kept outside the
// store so timers don't leak through serialization or get caught by
// React's strict double-render.
const typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const TYPING_TTL_MS = 3_000;

export const useChatStore = create<ChatStoreState>((set, get) => ({
  currentUserId: null,
  conversationsHydrated: false,
  conversationsById: {},
  conversationOrder: [],
  threadsByConversation: {},
  clearedAtByConversation: {},
  lastConnectedAt: null,
  activeConversationId: null,
  recentlyClearedAt: {},
  draftsByConversation: loadDrafts(),
  onlineUserIds: {},
  lastSeenByUserId: {},
  typingByConversation: {},
  uploadProgressById: {},

  // ---- Identity ----
  setCurrentUserId: (userId) => set({ currentUserId: userId }),
  setLastConnected: () => set({ lastConnectedAt: Date.now() }),
  setActiveConversationId: (conversationId) =>
    set({ activeConversationId: conversationId }),

  // ---- Conversation list ----
  setConversations: (conversations) => {
    const {
      conversationsById: existingById,
      activeConversationId,
      recentlyClearedAt,
      lastSeenByUserId: existingLastSeen,
    } = get();
    const CLEAR_GRACE_MS = 15_000; // Generous: server propagation + retry margin.
    const now = Date.now();
    const byId: Record<string, ChatConversationSummary> = {};
    // Seed last-seen from the DB values returned with the conversation
    // list. Live presence "leave" events overwrite these later — they're
    // more authoritative because they fire the instant the other user
    // disconnects. The DB value is just the fallback for "we never saw
    // them leave because we weren't online when they did."
    const nextLastSeen: Record<string, string> = { ...existingLastSeen };
    for (const c of conversations) {
      const existing = existingById[c.id];
      const clearedAt = recentlyClearedAt[c.id];
      const isActive = activeConversationId === c.id;
      const wasRecentlyCleared = clearedAt && now - clearedAt < CLEAR_GRACE_MS;
      // Honor the local clear over a stale DB count if either:
      //   (a) the user is *actively* viewing the conversation right now, or
      //   (b) the user cleared it within the last ~15s (gives the
      //       server-side markConversationRead time to propagate and stop
      //       returning stale unread_count from the next fetch).
      if (existing && (isActive || wasRecentlyCleared)) {
        byId[c.id] = { ...c, unread_count: existing.unread_count };
      } else {
        byId[c.id] = c;
      }
      // Seed last-seen, but never DOWNGRADE — only adopt the DB value if
      // it's newer than whatever the store already has. Live presence
      // events fire with NOW() timestamps; the DB row is sometimes a
      // heartbeat behind. Picking the max keeps the displayed time fresh.
      if (c.other_user_id && c.other_user_last_seen_at) {
        const prev = nextLastSeen[c.other_user_id];
        if (!prev || new Date(c.other_user_last_seen_at) > new Date(prev)) {
          nextLastSeen[c.other_user_id] = c.other_user_last_seen_at;
        }
      }
    }
    const order = sortIds(byId, conversations.map((c) => c.id));
    set({
      conversationsById: byId,
      conversationOrder: order,
      conversationsHydrated: true,
      lastSeenByUserId: nextLastSeen,
    });
  },

  upsertConversation: (conv) => {
    const { conversationsById, conversationOrder } = get();
    const nextById = { ...conversationsById, [conv.id]: conv };
    const ids = conversationOrder.includes(conv.id)
      ? conversationOrder
      : [...conversationOrder, conv.id];
    set({
      conversationsById: nextById,
      conversationOrder: sortIds(nextById, ids),
    });
  },

  patchConversation: (conversationId, patch) => {
    const { conversationsById, conversationOrder } = get();
    const existing = conversationsById[conversationId];
    if (!existing) return;
    const nextConv = { ...existing, ...patch };
    const nextById = { ...conversationsById, [conversationId]: nextConv };
    // Re-sort whenever something that affects ordering changes:
    // last_message_at moves rows by recency, is_pinned/pinned_at moves
    // them to (or out of) the pinned section.
    const needsResort =
      patch.last_message_at !== undefined ||
      patch.is_pinned !== undefined ||
      patch.pinned_at !== undefined;
    set({
      conversationsById: nextById,
      conversationOrder: needsResort
        ? sortIds(nextById, conversationOrder)
        : conversationOrder,
    });
  },

  // Bumps both the conversation summary AND the order so the chat hops to
  // the top — typical use-case after a new message arrives or is sent.
  bumpConversation: (conversationId, preview) => {
    const { conversationsById, conversationOrder } = get();
    const existing = conversationsById[conversationId];
    if (!existing) return;
    // Don't downgrade — if our local last_message_at is already newer (the
    // client beat the realtime event), keep ours.
    const existingAt = existing.last_message_at
      ? new Date(existing.last_message_at).getTime()
      : 0;
    const incomingAt = new Date(preview.last_message_at).getTime();
    if (existingAt > incomingAt) return;

    const nextConv: ChatConversationSummary = {
      ...existing,
      last_message_text: preview.last_message_text,
      last_message_at: preview.last_message_at,
      last_message_sender_id: preview.last_message_sender_id,
      last_message_seen: false,
    };
    const nextById = { ...conversationsById, [conversationId]: nextConv };
    set({
      conversationsById: nextById,
      conversationOrder: sortIds(nextById, conversationOrder),
    });
  },

  removeConversation: (conversationId) => {
    const {
      conversationsById,
      conversationOrder,
      threadsByConversation,
    } = get();
    if (!conversationsById[conversationId]) return;
    const nextById = { ...conversationsById };
    delete nextById[conversationId];
    const nextThreads = { ...threadsByConversation };
    delete nextThreads[conversationId];
    set({
      conversationsById: nextById,
      conversationOrder: conversationOrder.filter(
        (id) => id !== conversationId
      ),
      threadsByConversation: nextThreads,
    });
  },

  incrementUnread: (conversationId) => {
    const { conversationsById } = get();
    const existing = conversationsById[conversationId];
    if (!existing) return;
    set({
      conversationsById: {
        ...conversationsById,
        [conversationId]: {
          ...existing,
          unread_count: (existing.unread_count || 0) + 1,
        },
      },
    });
  },

  clearUnread: (conversationId) => {
    const { conversationsById, recentlyClearedAt } = get();
    const existing = conversationsById[conversationId];
    const nextClearedAt = { ...recentlyClearedAt, [conversationId]: Date.now() };
    if (!existing || existing.unread_count === 0) {
      // Even if the count was already 0, record the moment — a refetch
      // that comes through with stale DB data should still see this and
      // refuse to bump us back up.
      set({ recentlyClearedAt: nextClearedAt });
      return;
    }
    set({
      conversationsById: {
        ...conversationsById,
        [conversationId]: { ...existing, unread_count: 0 },
      },
      recentlyClearedAt: nextClearedAt,
    });
  },

  markPreviewSeen: (conversationId) => {
    const { conversationsById } = get();
    const existing = conversationsById[conversationId];
    if (!existing || existing.last_message_seen) return;
    set({
      conversationsById: {
        ...conversationsById,
        [conversationId]: { ...existing, last_message_seen: true },
      },
    });
  },

  // ---- Threads ----
  setThread: (conversationId, messages) => {
    const { threadsByConversation, clearedAtByConversation } = get();
    const existing = threadsByConversation[conversationId] || emptyThread(conversationId);

    // Honor any clearThread that ran while this fetch was in flight.
    // The fetch may have read messages BEFORE the server-side
    // message_deletions rows were inserted; without this filter those
    // pre-clear messages would repopulate the thread on resolve.
    const clearedAt = clearedAtByConversation[conversationId];
    if (clearedAt) {
      messages = messages.filter(
        (m) => new Date(m.created_at).getTime() > clearedAt,
      );
    }

    // Merge — don't blindly replace. Two kinds of messages from the
    // existing array can be legitimately "missing" from the incoming
    // fetch result and must be preserved:
    //
    //   1. Optimistic sends still on the wire (delivery_status: "pending").
    //   2. Messages that arrived via realtime *during* the fetch — the
    //      DB query happened before the row was inserted, so the response
    //      doesn't see it, but realtime delivered the row directly into
    //      the store while we waited. Without preserving these, every
    //      navigation back into a chat would briefly "lose" any message
    //      that arrived in the ~500ms it takes for the fetch to complete.
    //
    // Rule for (2): keep any existing message whose created_at is newer
    // than the latest message in the incoming set. That horizon is
    // exactly the cutoff between "fetch saw this" and "fetch couldn't
    // have seen this."
    const incomingIds = new Set(messages.map((m) => m.id));
    const latestIncomingTime = messages.length
      ? new Date(messages[messages.length - 1].created_at).getTime()
      : -1;

    const keptExtra = existing.messages.filter((m) => {
      if (incomingIds.has(m.id)) return false;
      if (m.delivery_status === "pending") return true;
      return new Date(m.created_at).getTime() > latestIncomingTime;
    });

    // Same media-preservation rule as upsertMessage's merge branch: if
    // the fetch returned a message we already have, but the fetched copy
    // has no media while the existing copy did, keep the existing media.
    // This catches the case where fetchMediaForMessages comes back empty
    // for a media-typed row because the SELECT raced the INSERT or RLS
    // blocked the read — without this, every refetch / reconnect would
    // blank out images that were rendering fine a moment ago.
    const existingById: Record<string, ChatMessage> = {};
    for (const m of existing.messages) existingById[m.id] = m;
    const reconciled = messages.map((m) => {
      const prev = existingById[m.id];
      if (
        prev && prev.media && prev.media.length > 0 &&
        (!m.media || m.media.length === 0)
      ) {
        return { ...m, media: prev.media };
      }
      return m;
    });

    const combined = keptExtra.length === 0
      ? reconciled
      : [...reconciled, ...keptExtra].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
    set({
      threadsByConversation: {
        ...threadsByConversation,
        [conversationId]: {
          conversationId,
          messages: combined,
          hydrated: true,
          fetchedAt: Date.now(),
        },
      },
    });
  },

  clearThread: (conversationId) => {
    const { threadsByConversation, clearedAtByConversation } = get();
    const existing = threadsByConversation[conversationId];
    const pending = (existing?.messages || []).filter(
      (m) => m.delivery_status === "pending",
    );
    set({
      threadsByConversation: {
        ...threadsByConversation,
        [conversationId]: {
          conversationId,
          messages: pending,
          hydrated: true,
          fetchedAt: Date.now(),
        },
      },
      clearedAtByConversation: {
        ...clearedAtByConversation,
        [conversationId]: Date.now(),
      },
    });
  },

  prependOlderMessages: (conversationId, older) => {
    if (older.length === 0) return;
    const { threadsByConversation, clearedAtByConversation } = get();
    const existing = threadsByConversation[conversationId];
    if (!existing) return;
    // Same horizon as setThread / upsertMessage — load-older results
    // can race past a clear too.
    const clearedAt = clearedAtByConversation[conversationId];
    const cutoffOlder = clearedAt
      ? older.filter((m) => new Date(m.created_at).getTime() > clearedAt)
      : older;
    if (cutoffOlder.length === 0) return;
    const existingIds = new Set(existing.messages.map((m) => m.id));
    const fresh = cutoffOlder.filter((m) => !existingIds.has(m.id));
    if (fresh.length === 0) return;
    // Combine + chronological sort. fresh comes in already
    // chronological from the API, but a merge-sort with the existing
    // tail is the safe move.
    const combined = [...fresh, ...existing.messages].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    set({
      threadsByConversation: {
        ...threadsByConversation,
        [conversationId]: { ...existing, messages: combined },
      },
    });
  },

  upsertMessage: (conversationId, message) => {
    const { threadsByConversation, clearedAtByConversation } = get();
    // Drop any message that predates a local clearThread for this
    // conversation. Catches a late-arriving realtime echo or any other
    // path that would otherwise resurrect a cleared message.
    const clearedAt = clearedAtByConversation[conversationId];
    if (clearedAt && new Date(message.created_at).getTime() <= clearedAt) {
      return;
    }
    const existing = threadsByConversation[conversationId] || emptyThread(conversationId);
    const idx = existing.messages.findIndex((m) => m.id === message.id);
    let nextMessages: ChatMessage[];
    if (idx === -1) {
      // New message — insert in chronological position. Most arrivals
      // are at the end (recent), so we optimize for that case.
      const last = existing.messages[existing.messages.length - 1];
      if (!last || new Date(message.created_at).getTime() >= new Date(last.created_at).getTime()) {
        nextMessages = [...existing.messages, message];
      } else {
        nextMessages = [...existing.messages, message].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      }
    } else {
      // Existing message — merge fields. Preserve client-side fields
      // (e.g. delivery_status if it's "pending" and the upsert from
      // realtime doesn't include a better status).
      //
      // If the merge changes created_at (typical case: realtime INSERT
      // for our own optimistic message brings in the authoritative
      // server timestamp, which can differ from the device clock used
      // for the optimistic add), resort. Otherwise device clock skew
      // leaves messages stuck in their pre-confirm position even though
      // the real ordering is now different.
      nextMessages = [...existing.messages];
      const oldMsg = nextMessages[idx];
      const merged = { ...oldMsg, ...message };
      // Never let a merge wipe a media array we already had. The realtime
      // INSERT echo of our own send fetches message_media right after the
      // INSERT — if RLS allows INSERT but blocks SELECT on the same row,
      // or if the read just races the write, the fetch returns empty and
      // the spread above would zero out a media array that was correct.
      // Prefer existing media if the incoming version is missing/empty.
      if (
        oldMsg.media && oldMsg.media.length > 0 &&
        (!merged.media || merged.media.length === 0)
      ) {
        merged.media = oldMsg.media;
      }
      const timeChanged = oldMsg.created_at !== merged.created_at;
      nextMessages[idx] = merged;
      if (timeChanged) {
        nextMessages = nextMessages.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      }
    }
    set({
      threadsByConversation: {
        ...threadsByConversation,
        [conversationId]: { ...existing, messages: nextMessages },
      },
    });
  },

  patchMessage: (conversationId, messageId, patch) => {
    const { threadsByConversation } = get();
    const existing = threadsByConversation[conversationId];
    if (!existing) return;
    const idx = existing.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const oldMsg = existing.messages[idx];
    const merged = { ...oldMsg, ...patch };
    // Same reason as upsertMessage's merge branch: if created_at moved
    // (which happens when useSendMessage patches the optimistic message
    // with the server-confirmed timestamp), the message may now belong
    // in a different position in the chronological order. Resort so the
    // UI doesn't show stale ordering after the patch lands.
    const timeChanged = oldMsg.created_at !== merged.created_at;
    let nextMessages = [...existing.messages];
    nextMessages[idx] = merged;
    if (timeChanged) {
      nextMessages = nextMessages.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }
    set({
      threadsByConversation: {
        ...threadsByConversation,
        [conversationId]: { ...existing, messages: nextMessages },
      },
    });
  },

  removeMessage: (conversationId, messageId) => {
    const { threadsByConversation } = get();
    const existing = threadsByConversation[conversationId];
    if (!existing) return;
    const nextMessages = existing.messages.filter((m) => m.id !== messageId);
    if (nextMessages.length === existing.messages.length) return;
    set({
      threadsByConversation: {
        ...threadsByConversation,
        [conversationId]: { ...existing, messages: nextMessages },
      },
    });
  },

  setMessageStatus: (conversationId, messageId, status) => {
    get().patchMessage(conversationId, messageId, { delivery_status: status });
  },

  markThreadHydrated: (conversationId) => {
    const { threadsByConversation } = get();
    const existing = threadsByConversation[conversationId] || emptyThread(conversationId);
    if (existing.hydrated) return;
    set({
      threadsByConversation: {
        ...threadsByConversation,
        [conversationId]: { ...existing, hydrated: true, fetchedAt: Date.now() },
      },
    });
  },

  // ---- Reactions ----
  // Both addReaction and removeReaction patch the target message's
  // `reactions` array in-place. Realtime + the optimistic UI both
  // route through here; the dedupe-on-id rule in addReaction means a
  // realtime echo of an insert we just optimistically applied is a
  // no-op (the temp id is replaced when the real row's id matches
  // already-present temp ids' replaceTempWith logic in the page).
  addReaction: (conversationId, messageId, reaction) => {
    const { threadsByConversation } = get();
    const existing = threadsByConversation[conversationId];
    if (!existing) return;
    const idx = existing.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const msg = existing.messages[idx];
    const current = msg.reactions || [];
    // Idempotent: same id already present → no-op.
    if (current.some((r) => r.id === reaction.id)) return;
    const nextMessages = [...existing.messages];
    nextMessages[idx] = { ...msg, reactions: [...current, reaction] };
    set({
      threadsByConversation: {
        ...threadsByConversation,
        [conversationId]: { ...existing, messages: nextMessages },
      },
    });
  },

  removeReaction: (conversationId, messageId, matcher) => {
    const { threadsByConversation } = get();
    const existing = threadsByConversation[conversationId];
    if (!existing) return;
    const idx = existing.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const msg = existing.messages[idx];
    const current = msg.reactions || [];
    if (current.length === 0) return;
    const next = current.filter((r) => {
      if (matcher.id !== undefined) return r.id !== matcher.id;
      if (matcher.userId !== undefined && matcher.emoji !== undefined) {
        return !(r.user_id === matcher.userId && r.emoji === matcher.emoji);
      }
      return true;
    });
    if (next.length === current.length) return;
    const nextMessages = [...existing.messages];
    nextMessages[idx] = { ...msg, reactions: next };
    set({
      threadsByConversation: {
        ...threadsByConversation,
        [conversationId]: { ...existing, messages: nextMessages },
      },
    });
  },

  replaceMyReaction: (conversationId, messageId, userId, replacement) => {
    const { threadsByConversation } = get();
    const existing = threadsByConversation[conversationId];
    if (!existing) return;
    const idx = existing.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const msg = existing.messages[idx];
    const current = msg.reactions || [];
    // Drop every reaction by this user (in practice ≤ 1 with our
    // "one reaction per user per message" rule) AND add the new
    // one — all in a single state transition.
    const without = current.filter((r) => r.user_id !== userId);
    const nextReactions = [...without, replacement];
    const nextMessages = [...existing.messages];
    nextMessages[idx] = { ...msg, reactions: nextReactions };
    set({
      threadsByConversation: {
        ...threadsByConversation,
        [conversationId]: { ...existing, messages: nextMessages },
      },
    });
  },

  // ---- Drafts ----
  // Persist on every keystroke. The DOM event rate is fine (<200/sec even
  // when typing fast); localStorage writes at that pace are still cheap
  // compared to the React re-render they trigger.
  setDraft: (conversationId, text) => {
    const { draftsByConversation } = get();
    const next = { ...draftsByConversation };
    if (text.length > 0) {
      next[conversationId] = text;
    } else {
      delete next[conversationId];
    }
    set({ draftsByConversation: next });
    persistDrafts(next);
  },

  clearDraft: (conversationId) => {
    const { draftsByConversation } = get();
    if (!(conversationId in draftsByConversation)) return;
    const next = { ...draftsByConversation };
    delete next[conversationId];
    set({ draftsByConversation: next });
    persistDrafts(next);
  },

  // ---- Presence ----
  // Replace the whole online set in one shot. Supabase presence "sync"
  // events give us the full state every time, so partial diffing here
  // would just complicate things without benefit.
  setOnlinePresence: (onlineUserIds) => {
    const { onlineUserIds: prev } = get();
    // Bail if nothing changed — avoids re-rendering every subscriber on
    // every heartbeat tick (Supabase fires sync periodically even when
    // nothing changed).
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(onlineUserIds);
    if (
      prevKeys.length === nextKeys.length &&
      prevKeys.every((k) => onlineUserIds[k])
    ) {
      return;
    }
    set({ onlineUserIds });
  },

  markUserOffline: (userId, at) => {
    const { onlineUserIds, lastSeenByUserId } = get();
    if (!onlineUserIds[userId] && lastSeenByUserId[userId] === at) return;
    const nextOnline = { ...onlineUserIds };
    delete nextOnline[userId];
    set({
      onlineUserIds: nextOnline,
      lastSeenByUserId: { ...lastSeenByUserId, [userId]: at },
    });
  },

  // ---- Typing / recording ----
  setTyping: (conversationId, userId, kind = "typing", userName) => {
    const key = `${conversationId}|${userId}`;
    if (typingTimers[key]) clearTimeout(typingTimers[key]);

    const { typingByConversation } = get();
    const existingForConv = typingByConversation[conversationId] || {};
    const existingForUser = existingForConv[userId];
    set({
      typingByConversation: {
        ...typingByConversation,
        [conversationId]: {
          ...existingForConv,
          [userId]: {
            kind,
            // Keep an older known name if the new broadcast didn't
            // carry one — protects against legacy senders.
            userName: userName ?? existingForUser?.userName,
            at: Date.now(),
          },
        },
      },
    });

    typingTimers[key] = setTimeout(() => {
      // TTL expired for this one user — drop their entry only. If
      // they were the last typer in the conversation, drop the
      // conversation entry too.
      const { typingByConversation: curMap } = get();
      const inner = curMap[conversationId];
      if (!inner || !inner[userId]) return;
      const { [userId]: _removed, ...rest } = inner;
      void _removed;
      const nextMap = { ...curMap };
      if (Object.keys(rest).length === 0) {
        delete nextMap[conversationId];
      } else {
        nextMap[conversationId] = rest;
      }
      set({ typingByConversation: nextMap });
      delete typingTimers[key];
    }, TYPING_TTL_MS);
  },

  clearTyping: (conversationId, userId) => {
    const { typingByConversation } = get();
    const inner = typingByConversation[conversationId];
    if (!inner) return;

    // Single-user clear: drop that one entry. If it was the last
    // typer, drop the conversation entry too.
    if (userId) {
      if (!inner[userId]) return;
      const { [userId]: _removed, ...rest } = inner;
      void _removed;
      const nextMap = { ...typingByConversation };
      if (Object.keys(rest).length === 0) {
        delete nextMap[conversationId];
      } else {
        nextMap[conversationId] = rest;
      }
      // Also cancel that user's TTL timer to keep typingTimers clean.
      const key = `${conversationId}|${userId}`;
      if (typingTimers[key]) {
        clearTimeout(typingTimers[key]);
        delete typingTimers[key];
      }
      set({ typingByConversation: nextMap });
      return;
    }

    // Full clear (channel unsubscribe path): wipe every typer for
    // this conversation and cancel their timers.
    for (const otherUserId of Object.keys(inner)) {
      const key = `${conversationId}|${otherUserId}`;
      if (typingTimers[key]) {
        clearTimeout(typingTimers[key]);
        delete typingTimers[key];
      }
    }
    const nextMap = { ...typingByConversation };
    delete nextMap[conversationId];
    set({ typingByConversation: nextMap });
  },

  // ---- Upload progress ----
  setUploadProgress: (messageId, progress) => {
    const { uploadProgressById } = get();
    set({
      uploadProgressById: { ...uploadProgressById, [messageId]: progress },
    });
  },

  clearUploadProgress: (messageId) => {
    const { uploadProgressById } = get();
    if (!uploadProgressById[messageId]) return;
    const next = { ...uploadProgressById };
    delete next[messageId];
    set({ uploadProgressById: next });
  },

  // ---- Maintenance ----
  // Wipe drafts too — different account, different state. The outbox is
  // cleared by the realtime/init layer (it's user-scoped in storage).
  reset: () => {
    persistDrafts({});
    // Flush any pending typing timers so they don't fire into the next
    // session's state.
    for (const k of Object.keys(typingTimers)) {
      clearTimeout(typingTimers[k]);
      delete typingTimers[k];
    }
    set({
      currentUserId: null,
      conversationsHydrated: false,
      conversationsById: {},
      conversationOrder: [],
      threadsByConversation: {},
      clearedAtByConversation: {},
      lastConnectedAt: null,
      activeConversationId: null,
      recentlyClearedAt: {},
      draftsByConversation: {},
      onlineUserIds: {},
      lastSeenByUserId: {},
      typingByConversation: {},
      uploadProgressById: {},
    });
  },
}));
