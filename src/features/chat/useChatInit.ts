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
      // No user — wipe the store + cancel realtime. Doing it in this
      // order means downstream subscribers see an empty store before the
      // channel goes silent, which is the correct order.
      store.reset();
      stopChatRealtime().catch(() => {});
      return;
    }

    store.setCurrentUserId(userId);
    startChatRealtime(userId).catch(() => {});

    // First-time fetch of the conversation list for this session. Skipped
    // if we've already hydrated — realtime keeps it fresh after that.
    if (!store.conversationsHydrated) {
      fetchConversationList(userId)
        .then((list) => useChatStore.getState().setConversations(list))
        .catch(() => {});
    }
  }, [userId]);
}
