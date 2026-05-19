"use client";

// Hook that boots the v2 chat system for the current user. Both v2 pages
// call this at the top — it's safe to call multiple times because the
// underlying realtime layer dedups by user id.
//
// Responsibilities:
//   - Sync the auth'd user id into the chat store.
//   - Kick off the realtime subscription (idempotent).
//   - Fetch the conversation list on first call (idempotent — checks
//     conversationsHydrated before re-fetching).
//   - Tear everything down when the user signs out.
//
// Once we mount this in the root layout (Phase 6 polish), all of this
// happens at app boot regardless of which page you're on. For Phase 1
// it's only active while a v2 page is mounted, which is fine because v2
// is gated behind the /messages-v2/* URL.

import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "./store";
import { startChatRealtime, stopChatRealtime } from "./realtime";
import { fetchConversationList } from "./api";

export function useChatInit() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    const store = useChatStore.getState();

    if (!userId) {
      console.log("[chat-v2] no user — resetting store + stopping realtime");
      store.reset();
      stopChatRealtime().catch(() => {});
      return;
    }

    console.log("[chat-v2] init for user", userId, "hydrated:", store.conversationsHydrated);
    store.setCurrentUserId(userId);
    startChatRealtime(userId).catch((e) => console.error("[chat-v2] startChatRealtime failed", e));

    if (!store.conversationsHydrated) {
      fetchConversationList(userId)
        .then((list) => {
          console.log("[chat-v2] fetched conversation list:", list.length, "conversations");
          useChatStore.getState().setConversations(list);
        })
        .catch((e) => console.error("[chat-v2] fetchConversationList failed", e));
    }
  }, [userId]);
}
