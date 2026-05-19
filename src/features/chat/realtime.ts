// Realtime layer for v2 chat. One channel per logged-in user. Listens to
// the DB tables that drive both the conversation list and open threads,
// dispatches into the Zustand store.
//
// Critical: Supabase Realtime is the *primary* source of truth here. The
// previous architecture treated it as a "nice to have" that ran alongside
// per-mount fetches, which led to the popping + missing-message bugs. In
// v2 the rule is: realtime updates flow into the store immediately; fetches
// only run on first load or explicit refresh.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "./store";
import { fetchConversationList, markConversationRead } from "./api";
import type { ChatMessage } from "./types";

// We keep a single active channel reference here so successive start()
// calls dedupe — important because React StrictMode in dev mounts effects
// twice, and we don't want two parallel channels for the same user.
let activeChannel: RealtimeChannel | null = null;
let activeUserId: string | null = null;

/**
 * Subscribe to realtime for the given user. Idempotent — calling twice
 * with the same userId is a no-op. Calling with a different userId tears
 * down the old channel first.
 */
export async function startChatRealtime(userId: string): Promise<void> {
  if (activeUserId === userId && activeChannel) return; // already subscribed

  // Tear down any previous subscription before opening a new one.
  if (activeChannel) {
    try { await supabase.removeChannel(activeChannel); } catch {}
    activeChannel = null;
    activeUserId = null;
  }

  console.log("[chat-v2] starting realtime for user", userId);

  const channel = supabase
    .channel(`chat-v2-${userId}`)
    // ---- New message inserted (any conversation, RLS scopes to ours) ----
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      async (payload) => {
        console.log("[chat-v2] INSERT messages event", payload.new);
        const row = payload.new as any;
        if (!row?.id || !row?.conversation_id) return;
        await handleMessageInsert(row, userId);
      }
    )
    // ---- Existing message updated (edit, delete) ----
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages" },
      (payload) => {
        console.log("[chat-v2] UPDATE messages event", payload.new);
        const row = payload.new as any;
        if (!row?.id || !row?.conversation_id) return;
        useChatStore.getState().patchMessage(row.conversation_id, row.id, {
          content: row.content,
          edited_at: row.edited_at,
          is_deleted: row.is_deleted,
          content_type: row.content_type,
        });
      }
    )
    // ---- Conversation row updated (trigger fires this when last_message_* changes) ----
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "conversations" },
      (payload) => {
        console.log("[chat-v2] UPDATE conversations event", payload.new);
        const row = payload.new as any;
        if (!row?.id) return;
        useChatStore.getState().patchConversation(row.id, {
          last_message_text: row.last_message_text ?? null,
          last_message_at: row.last_message_at ?? null,
          last_message_sender_id: row.last_message_sender_id ?? null,
        });
      }
    )
    // ---- Other participant's last_read_at advanced (drives "seen" badge) ----
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "conversation_participants" },
      (payload) => {
        console.log("[chat-v2] UPDATE conversation_participants event", payload.new);
        const row = payload.new as any;
        if (!row?.conversation_id || !row?.user_id) return;
        if (row.user_id === userId) return; // our own read state is local
        if (!row.last_read_at) return;

        const state = useChatStore.getState();
        const conv = state.conversationsById[row.conversation_id];
        if (
          conv &&
          conv.last_message_sender_id === userId &&
          conv.last_message_at &&
          !conv.last_message_seen &&
          new Date(row.last_read_at) >= new Date(conv.last_message_at)
        ) {
          state.markPreviewSeen(row.conversation_id);
        }

        // Also patch delivery_status on any open thread's messages from us.
        const thread = state.threadsByConversation[row.conversation_id];
        if (thread) {
          for (const msg of thread.messages) {
            if (
              msg.sender_id === userId &&
              msg.delivery_status !== "seen" &&
              new Date(row.last_read_at) >= new Date(msg.created_at)
            ) {
              state.patchMessage(row.conversation_id, msg.id, {
                delivery_status: "seen",
              });
            }
          }
        }
      }
    )
    .subscribe((status, err) => {
      console.log("[chat-v2] subscribe status:", status, err || "");
      // Every transition to SUBSCRIBED — including reconnects after a
      // dropped websocket — bumps lastConnectedAt. Pages watch that value
      // in their deps and refetch on change, which catches up any events
      // that fired during the disconnect window. Supabase doesn't replay
      // those events, so without this on flaky networks every drop leaves
      // a permanent gap until the next manual refresh.
      if (status === "SUBSCRIBED") {
        useChatStore.getState().setLastConnected();
      }
    });

  activeChannel = channel;
  activeUserId = userId;
}

/**
 * Tear down the realtime subscription. Called on sign-out or when the
 * provider unmounts (e.g. user logs out).
 */
export async function stopChatRealtime(): Promise<void> {
  if (!activeChannel) return;
  try { await supabase.removeChannel(activeChannel); } catch {}
  activeChannel = null;
  activeUserId = null;
}

// =====================================================
// INSERT handler — heavier than the simple UPDATE handlers so it gets its
// own function. We may need to add the message to a not-yet-loaded thread,
// or insert a brand-new conversation row if the realtime arrives before
// fetchConversationList does.
// =====================================================
async function handleMessageInsert(row: any, currentUserId: string) {
  const state = useChatStore.getState();
  const conversationId = row.conversation_id;

  const message: ChatMessage = {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content ?? null,
    content_type: row.content_type ?? "text",
    created_at: row.created_at,
    edited_at: row.edited_at ?? null,
    is_deleted: row.is_deleted ?? false,
    reply_to_id: row.reply_to_id ?? null,
    delivery_status: "sent",
  };

  // 1. Patch the thread. upsertMessage handles dedup against an optimistic
  //    pending entry with the same UUID — that entry's status flips from
  //    "pending" to "sent" via the merge.
  state.upsertMessage(conversationId, message);

  // 2. Update the conversation summary. If we already have the conversation
  //    in our list, just bump it. If not, this is a new DM — refetch the
  //    full list so the row appears.
  const conv = state.conversationsById[conversationId];
  if (conv) {
    state.bumpConversation(conversationId, {
      last_message_text:
        message.content_type === "text"
          ? (message.content?.slice(0, 100) ?? "")
          : "Sent an attachment",
      last_message_at: message.created_at,
      last_message_sender_id: message.sender_id,
    });

    // Unread + read-receipt handling. Two cases when the message is from
    // the other user:
    //
    //   (a) User is actively viewing this conversation → they've already
    //       seen the message before the badge could appear. We skip the
    //       increment AND advance the server-side last_read_at so the
    //       other person's "seen" indicator updates in real time
    //       (matches WhatsApp behavior).
    //
    //   (b) User is elsewhere (list, another conv, another page) → bump
    //       the badge. clearUnread + markConversationRead get called the
    //       moment they open this conversation.
    if (message.sender_id !== currentUserId) {
      const isActive = state.activeConversationId === conversationId;
      if (isActive) {
        markConversationRead(conversationId, currentUserId).catch(() => {});
      } else {
        state.incrementUnread(conversationId);
      }
    }
  } else {
    // First time we're hearing of this conversation — fetch the full
    // list so the new conversation appears with its other-user info.
    try {
      const list = await fetchConversationList(currentUserId);
      state.setConversations(list);
    } catch {}
  }
}
