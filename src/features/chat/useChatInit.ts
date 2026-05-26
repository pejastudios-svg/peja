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
import {
  useChatStore,
  readConversationsCache,
  persistConversationsCache,
} from "./store";
import { startChatRealtime, stopChatRealtime } from "./realtime";
import { startPresence, stopPresence } from "./presence";
import { startHeartbeat, stopHeartbeat } from "./heartbeat";
import { fetchConversationList } from "./api";
import { readOutbox } from "./outbox";
import { getBlob } from "./mediaBlobs";
import { useOutboxDrain } from "./useOutboxDrain";
import { useActionQueueDrain } from "./useActionQueueDrain";
import type { ChatMessageMedia } from "./types";

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
      stopHeartbeat();
      return;
    }

    console.log("[chat-v2] init for user", userId);
    store.setCurrentUserId(userId);

    // Seed the conversation list from localStorage so /messages can
    // render the chat list immediately, even when offline. Without
    // this, `conversationsHydrated` only flips to true after a
    // successful network refetch (see the lastConnectedAt effect
    // below) — cold offline opens would show skeletons forever. The
    // network refetch overlays fresh data when it lands.
    const cached = readConversationsCache(userId);
    if (cached.length > 0) {
      store.setConversations(cached);
    }

    // Rehydrate the outbox into the store. Each queued item appears as
    // a "failed" message in its thread so the user immediately sees what
    // didn't get through; useOutboxDrain flips them back to "pending" as
    // it retries. We deliberately don't mark them "pending" up front —
    // that would imply the send is actively in flight, which it isn't
    // until drain attempts run.
    const queued = readOutbox(userId);
    for (const item of queued) {
      const hasMedia = item.media && item.media.length > 0;
      store.upsertMessage(item.conversation_id, {
        id: item.id,
        conversation_id: item.conversation_id,
        sender_id: item.sender_id,
        content: item.content || null,
        content_type: hasMedia ? "media" : "text",
        created_at: item.created_at,
        edited_at: null,
        is_deleted: false,
        reply_to_id: null,
        delivery_status: "failed",
      });
      // For media items, asynchronously rebuild blob URLs from IDB so
      // the bubble can render the preview instead of a broken icon. We
      // fire-and-forget — the drain attempts upload regardless.
      if (hasMedia) {
        void hydrateOutboxMedia(item.id, item.conversation_id, item.media!);
      }
    }

    startChatRealtime(userId).catch((e) => console.error("[chat-v2] startChatRealtime failed", e));
    startPresence(userId).catch((e) => console.error("[chat-v2] startPresence failed", e));
    startHeartbeat(userId);
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
        persistConversationsCache(userId, list);
      })
      .catch((e) => console.error("[chat-v2] fetchConversationList failed", e));
  }, [userId, lastConnectedAt]);

  // Outbox drain — listens for online + visibility + reconnect events
  // and replays anything still queued. Self-contained, idempotent.
  useOutboxDrain(userId);
  // Same pattern but for non-send actions (edit, delete-me,
  // delete-all, react-add, react-remove). Lives in a parallel queue
  // (actionQueue.ts) because the data shapes don't overlap with the
  // send outbox's OutboxItem.
  useActionQueueDrain(userId);
}

// Build blob: URLs for a queued media message and patch them onto the
// store entry so the bubble shows the image rather than a broken icon.
// Each attachment's blob lives in IDB keyed by (message id, attachment id).
async function hydrateOutboxMedia(
  messageId: string,
  conversationId: string,
  attachments: NonNullable<ReturnType<typeof readOutbox>[number]["media"]>
): Promise<void> {
  const media: ChatMessageMedia[] = [];
  for (const att of attachments) {
    try {
      const blob = await getBlob(messageId, att.attachment_id);
      if (!blob) continue;
      const url = att.uploaded_url || URL.createObjectURL(blob);
      media.push({
        id: att.attachment_id,
        message_id: messageId,
        url,
        media_type: att.media_type,
        file_name: att.file_name,
        file_size: att.size,
        mime_type: att.mime_type,
        thumbnail_url: null,
        created_at: new Date().toISOString(),
        optimistic: !att.uploaded_url,
      });
    } catch (e) {
      console.warn("[chat-v2] hydrateOutboxMedia failed for", att.attachment_id, e);
    }
  }
  if (media.length === 0) return;
  useChatStore.getState().patchMessage(conversationId, messageId, { media });
}
