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
  incrementUnread: (conversationId: string) => void;
  clearUnread: (conversationId: string) => void;
  markPreviewSeen: (conversationId: string) => void;

  // === Thread actions ===
  setThread: (conversationId: string, messages: ChatMessage[]) => void;
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
    const at = byId[aId]?.last_message_at
      ? new Date(byId[aId].last_message_at!).getTime()
      : 0;
    const bt = byId[bId]?.last_message_at
      ? new Date(byId[bId].last_message_at!).getTime()
      : 0;
    return bt - at;
  });
}

function emptyThread(conversationId: string): ChatThread {
  return { conversationId, messages: [], hydrated: false, fetchedAt: null };
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  currentUserId: null,
  conversationsHydrated: false,
  conversationsById: {},
  conversationOrder: [],
  threadsByConversation: {},
  lastConnectedAt: null,
  activeConversationId: null,
  recentlyClearedAt: {},

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
    } = get();
    const CLEAR_GRACE_MS = 15_000; // Generous: server propagation + retry margin.
    const now = Date.now();
    const byId: Record<string, ChatConversationSummary> = {};
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
    }
    const order = sortIds(byId, conversations.map((c) => c.id));
    set({
      conversationsById: byId,
      conversationOrder: order,
      conversationsHydrated: true,
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
    // Resort only if last_message_at changed — typical case for previews.
    const needsResort = patch.last_message_at !== undefined;
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
    const { threadsByConversation } = get();
    const existing = threadsByConversation[conversationId] || emptyThread(conversationId);

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

    const combined = keptExtra.length === 0
      ? messages
      : [...messages, ...keptExtra].sort(
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

  upsertMessage: (conversationId, message) => {
    const { threadsByConversation } = get();
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
      const merged = { ...nextMessages[idx], ...message };
      const timeChanged = nextMessages[idx].created_at !== merged.created_at;
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

  // ---- Maintenance ----
  reset: () =>
    set({
      currentUserId: null,
      conversationsHydrated: false,
      conversationsById: {},
      conversationOrder: [],
      threadsByConversation: {},
      lastConnectedAt: null,
      activeConversationId: null,
      recentlyClearedAt: {},
    }),
}));
