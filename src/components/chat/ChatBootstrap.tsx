"use client";

// Bootstraps the v2 chat system at the root of the app so the
// conversation list (and presence / outbox drain) are populated on
// every page, not just when the user opens /messages.
//
// Replaces v1's <MessageCacheProvider> wrap. Renders nothing — it
// only exists so a hook can run at the layout level inside a client
// boundary.

import { useChatInit } from "@/features/chat/useChatInit";

export function ChatBootstrap() {
  useChatInit();
  return null;
}
