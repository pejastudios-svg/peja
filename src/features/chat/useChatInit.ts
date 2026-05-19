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

import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "./store";
import { startChatRealtime, stopChatRealtime } from "./realtime";
import { fetchConversationList } from "./api";

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
      return;
    }

    console.log("[chat-v2] init for user", userId);
    store.setCurrentUserId(userId);
    startChatRealtime(userId).catch((e) => console.error("[chat-v2] startChatRealtime failed", e));
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
}
