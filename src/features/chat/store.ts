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

  // === Identity actions ===
  setCurrentUserId: (userId: string | null) => void;
  setLastConnected: () => void;

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

  // ---- Identity ----
  setCurrentUserId: (userId) => set({ currentUserId: userId }),
  setLastConnected: () => set({ lastConnectedAt: Date.now() }),

  // ---- Conversation list ----
  setConversations: (conversations) => {
    const byId: Record<string, ChatConversationSummary> = {};
    for (const c of conversations) byId[c.id] = c;
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
    const { conversationsById } = get();
    const existing = conversationsById[conversationId];
    if (!existing || existing.unread_count === 0) return;
    set({
      conversationsById: {
        ...conversationsById,
        [conversationId]: { ...existing, unread_count: 0 },
      },
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
    // Preserve any in-flight `pending` messages that haven't been confirmed
    // yet — server fetch shouldn't drop them. Match by id (UUIDs are
    // client-generated and stable through pending → sent).
    const incomingIds = new Set(messages.map((m) => m.id));
    const keptPending = existing.messages.filter(
      (m) => m.delivery_status === "pending" && !incomingIds.has(m.id)
    );
    const combined = keptPending.length === 0
      ? messages
      : [...messages, ...keptPending].sort(
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
      nextMessages = [...existing.messages];
      nextMessages[idx] = { ...nextMessages[idx], ...message };
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
    const nextMessages = [...existing.messages];
    nextMessages[idx] = { ...nextMessages[idx], ...patch };
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
    }),
}));
