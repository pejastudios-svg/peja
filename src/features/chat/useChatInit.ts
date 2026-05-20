"use client";

// Hook that boots the v2 chat system for the current user. Both v2 pages
// call this at the top — it's safe to call multiple times because the
// underlying realtime layer dedups by user id.
//
// Conversation list is refetched on every realtime SUBSCRIBED event,
// including reconnects after a dropped websocket. Supabase Realtime
// doesn't replay events that fired while we were disconnected, so on
// flaky networks every drop creates a permanent gap unless we refetch
// when the channel comes back. The store's `lastConnectedAt` is bumped
// in realtime.ts and watched here as the trigger.
//
// Phase 2 additions:
//   • Rehydrates the persistent outbox into the store so messages that
//     were "pending" or "failed" at the last app close re-appear in
//     their threads.
//   • Kicks the drain hook so queued items send themselves when the
//     network comes back.

import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "./store";
import { startChatRealtime, stopChatRealtime } from "./realtime";
import { startPresence, stopPresence } from "./presence";
import { fetchConversationList } from "./api";
import { readOutbox } from "./outbox";
import { useOutboxDrain } from "./useOutboxDrain";

export function useChatInit() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const lastConnectedAt = useChatStore((s) => s.lastConnectedAt);

  useEffect(() => {
    const store = useChatStore.getState();

    if (!userId) {
      console.log("[chat-v2] no user — resetting store + stopping realtime");
      store.reset();
      stopChatRealtime().catch(() => {});
      stopPresence().catch(() => {});
      return;
    }

    console.log("[chat-v2] init for user", userId);
    store.setCurrentUserId(userId);

    // Rehydrate the outbox into the store. Each queued item appears as
    // a "failed" message in its thread so the user immediately sees what
    // didn't get through; useOutboxDrain flips them back to "pending" as
    // it retries. We deliberately don't mark them "pending" up front —
    // that would imply the send is actively in flight, which it isn't
    // until drain attempts run.
    const queued = readOutbox(userId);
    for (const item of queued) {
      store.upsertMessage(item.conversation_id, {
        id: item.id,
        conversation_id: item.conversation_id,
        sender_id: item.sender_id,
        content: item.content,
        content_type: "text",
        created_at: item.created_at,
        edited_at: null,
        is_deleted: false,
        reply_to_id: null,
        delivery_status: "failed",
      });
    }

    startChatRealtime(userId).catch((e) => console.error("[chat-v2] startChatRealtime failed", e));
    startPresence(userId).catch((e) => console.error("[chat-v2] startPresence failed", e));
  }, [userId]);

  // Conversation list (re)fetch effect. Fires on:
  //   • First channel SUBSCRIBED (initial load)
  //   • Every subsequent SUBSCRIBED — i.e. reconnect after a drop
  // Both paths want the same thing (fresh DB state), so they share an effect.
  useEffect(() => {
    if (!userId) return;
    if (lastConnectedAt === null) return;
    console.log("[chat-v2] refetching conversation list after (re)connect", lastConnectedAt);
    fetchConversationList(userId)
      .then((list) => {
        console.log("[chat-v2] fetched conversation list:", list.length);
        useChatStore.getState().setConversations(list);
      })
      .catch((e) => console.error("[chat-v2] fetchConversationList failed", e));
  }, [userId, lastConnectedAt]);

  // Outbox drain — listens for online + visibility + reconnect events
  // and replays anything still queued. Self-contained, idempotent.
  useOutboxDrain(userId);
}
