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
import {
  fetchConversationList,
  fetchMediaForMessages,
  fetchReplyTargets,
  markConversationRead,
  unhideConversation,
} from "./api";
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
    // ---- Existing message updated (edit, delete, pin) ----
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
          // Pin state must sync across devices. Without these the
          // store would stay at the old is_pinned value even after
          // another device pinned / unpinned the message, and the
          // pinned-message banner / per-bubble pin icon would never
          // update. pinned_by is on the DB row but not in the
          // ChatMessage type — the UI never reads it.
          is_pinned: row.is_pinned,
          pinned_at: row.pinned_at,
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
    // ---- Other participant's row changed (last_read_at for seen
    //      badge, is_blocked for the "you've been blocked" banner) ----
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "conversation_participants" },
      (payload) => {
        console.log("[chat-v2] UPDATE conversation_participants event", payload.new);
        const row = payload.new as any;
        if (!row?.conversation_id || !row?.user_id) return;
        if (row.user_id === userId) return; // our own row → handled locally

        const state = useChatStore.getState();
        const conv = state.conversationsById[row.conversation_id];

        // 1. Block-state flip — patch first because is_blocked may
        //    change WITHOUT last_read_at changing (the only field the
        //    handler used to look at). Drives the in-thread blocked
        //    banner that replaces the composer.
        if (
          conv &&
          typeof row.is_blocked === "boolean" &&
          conv.blocked_by_other !== row.is_blocked
        ) {
          state.patchConversation(row.conversation_id, {
            blocked_by_other: row.is_blocked,
          });
        }

        // 2. Read-receipt advance — only runs if last_read_at is set.
        if (!row.last_read_at) return;
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
    // ---- Reactions on any message inside our threads ----
    //   • INSERT carries the full new row → we can route by message_id
    //     directly. The store dedupes if our optimistic add already
    //     inserted a row with the same id.
    //   • DELETE on most Supabase tables only ships the primary key
    //     (REPLICA IDENTITY DEFAULT), so we don't have message_id.
    //     We walk every open thread and remove any reaction with the
    //     deleted id. Cheap because threads are small and reactions
    //     even smaller.
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "message_reactions" },
      (payload) => {
        const row = payload.new as {
          id: string;
          message_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        if (!row?.id || !row?.message_id) return;
        const state = useChatStore.getState();
        for (const [cid, thread] of Object.entries(state.threadsByConversation)) {
          if (!thread) continue;
          if (thread.messages.some((m) => m.id === row.message_id)) {
            state.addReaction(cid, row.message_id, row);
            return;
          }
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "message_reactions" },
      (payload) => {
        const row = payload.old as { id?: string };
        if (!row?.id) return;
        const state = useChatStore.getState();
        for (const [cid, thread] of Object.entries(state.threadsByConversation)) {
          if (!thread) continue;
          for (const msg of thread.messages) {
            if (msg.reactions?.some((r) => r.id === row.id)) {
              state.removeReaction(cid, msg.id, { id: row.id });
              return;
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

  // For media messages, the row alone isn't enough — the URLs live in
  // message_media. Fetch them now so the bubble can render the image as
  // soon as it lands. (Our own optimistic message already has media
  // populated client-side; upsertMessage's merge below preserves that.)
  const contentType = row.content_type ?? "text";
  const isSystem = contentType === "system";
  let media: ChatMessage["media"];
  // System rows ("X joined/left") never carry media, so skip the media
  // hydration + its 600ms retry entirely.
  if (contentType !== "text" && !isSystem) {
    try {
      let map = await fetchMediaForMessages([row.id]);
      let rows = map[row.id];
      // sendMediaMessage performs two separate inserts: first `messages`,
      // then `message_media`. Postgres realtime emits the `messages`
      // INSERT before the second statement has committed, so the very
      // first fetch can race in and return 0 rows even though the media
      // is being written right now. Retry once after a short delay — by
      // then the second insert has landed in every observed case. (If
      // it's still empty after the retry, it really is a non-media row
      // or an RLS-blocked SELECT, and we'd just be re-failing the
      // fetch.)
      if (!rows || rows.length === 0) {
        await new Promise((r) => setTimeout(r, 600));
        map = await fetchMediaForMessages([row.id]);
        rows = map[row.id];
        console.log("[chat-v2] INSERT media fetch (retry)", {
          id: row.id,
          fetched_count: rows?.length ?? 0,
        });
      } else {
        console.log("[chat-v2] INSERT media fetch", {
          id: row.id,
          fetched_count: rows.length,
        });
      }
      media = rows;
    } catch (e) {
      console.warn("[chat-v2] fetchMediaForMessages on INSERT failed", e);
    }
  }

  // Resolve the parent message snapshot if this is a reply, so the
  // quoted-reference block renders the moment the bubble appears.
  // Skip on our own optimistic echo — the optimistic message already
  // has reply_to populated, and upsertMessage's merge preserves it.
  let replyTo: ChatMessage["reply_to"];
  if (row.reply_to_id && row.sender_id !== currentUserId) {
    try {
      const targets = await fetchReplyTargets([row.reply_to_id]);
      replyTo = targets[row.reply_to_id] ?? null;
    } catch (e) {
      console.warn("[chat-v2] fetchReplyTargets on INSERT failed", e);
    }
  }

  const message: ChatMessage = {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    content: row.content ?? null,
    content_type: contentType,
    created_at: row.created_at,
    edited_at: row.edited_at ?? null,
    is_deleted: row.is_deleted ?? false,
    reply_to_id: row.reply_to_id ?? null,
    delivery_status: "sent",
    // Empty arrays are truthy in JS, so the previous `media ? ...` check
    // would pass an empty array through and wipe good media in the store.
    // Only include the field when it actually has rows.
    ...(media && media.length > 0 ? { media } : {}),
    ...(replyTo !== undefined ? { reply_to: replyTo } : {}),
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
    // System messages (joins/leaves) must not bump the unread badge — their
    // sender_id is the joining/leaving user, not a real message from them.
    if (message.sender_id !== currentUserId && !isSystem) {
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
    //
    // Also clears any leftover hidden_at on our participant row: a
    // conversation we previously "deleted" should come back into the
    // list as soon as the other side sends something new (this update
    // is what the chat-info "Delete chat" action relies on for sane
    // re-discovery semantics).
    try {
      if (message.sender_id !== currentUserId) {
        // await so the subsequent fetchConversationList sees the row
        // with hidden_at cleared. If we fired-and-forgot, the refetch
        // would race the UPDATE and the "deleted" conversation would
        // stay invisible even though a new message just arrived.
        await unhideConversation(conversationId, currentUserId).catch(() => {});
      }
      const list = await fetchConversationList(currentUserId);
      state.setConversations(list);
    } catch {}
  }
}
