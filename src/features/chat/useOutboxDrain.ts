"use client";

// Outbox drain hook. Watches for "we should try sending again" events and
// kicks the outbox. Triggers:
//
//   • window 'online' event — browser detected network recovery.
//   • document 'visibilitychange' to "visible" — app foregrounded.
//   • Realtime SUBSCRIBED (lastConnectedAt change) — Supabase is alive.
//
// All three flow through one drain function with a re-entrancy lock so
// concurrent triggers don't double-send the same item.
//
// The drain itself is FIFO across the user's whole outbox. Per-conversation
// ordering is preserved because adds are sequential. We don't bother with
// a per-conversation queue — within a single user's session the rate is
// trivially low (one user typing).

import { useEffect, useRef } from "react";
import { useChatStore } from "./store";
import {
  readOutbox,
  removeFromOutbox,
  patchOutboxItem,
  markSendInFlight,
  clearSendInFlight,
} from "./outbox";
import { sendTextMessage } from "./api";
import { uploadAndSendMedia } from "./useSendMessage";
import { getBlob, removeBlobsForMessage } from "./mediaBlobs";
import type { OutboxItem } from "./types";

// Cap retries per item. After this we leave it in the outbox but stop
// auto-retrying — user can tap the failed bubble to manually retry.
const MAX_AUTO_ATTEMPTS = 5;

export function useOutboxDrain(userId: string | null): void {
  const lastConnectedAt = useChatStore((s) => s.lastConnectedAt);
  const draining = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (typeof window === "undefined") return;

    async function drain() {
      if (draining.current) return;
      if (!navigator.onLine) return; // Browser knows we're offline — skip.
      draining.current = true;
      try {
        const items = readOutbox(userId!);
        for (const item of items) {
          if ((item.attempts ?? 0) >= MAX_AUTO_ATTEMPTS) continue;
          await attemptSend(userId!, item);
        }
      } finally {
        draining.current = false;
      }
    }

    const onOnline = () => {
      console.log("[chat-v2] outbox drain: online event");
      void drain();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        console.log("[chat-v2] outbox drain: app foregrounded");
        void drain();
      }
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    // Kick once on mount in case there's a queued item from a previous
    // session and we're already online.
    void drain();

    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, lastConnectedAt]);
}

// Send one outbox item. Sequential by design — the for-loop in drain()
// awaits each so we don't burst-fire the Supabase client when the user
// has a backlog of unsent messages.
async function attemptSend(userId: string, item: OutboxItem): Promise<void> {
  const store = useChatStore.getState();
  // Skip if this exact message is already being sent (by the live send path or
  // a concurrent drain/retry). Prevents the double-upload + false-"failed" race.
  if (!markSendInFlight(item.id)) return;
  patchOutboxItem(userId, item.id, { attempts: (item.attempts ?? 0) + 1 });
  // Show the user we're trying — flip "failed" back to "pending" during
  // the network call so the bubble doesn't sit red while we retry.
  store.patchMessage(item.conversation_id, item.id, {
    delivery_status: "pending",
  });

  try {
    let createdAt: string;
    let mediaForStore;
    if (item.media && item.media.length > 0) {
      // Media item — pull blobs back out of IDB and replay the same
      // uploadAndSendMedia path the live send uses. If a blob is missing
      // (older outbox + IDB cleared, or a different device), we have no
      // choice but to drop the item.
      const files: File[] = [];
      for (const att of item.media) {
        const blob = await getBlob(item.id, att.attachment_id);
        if (!blob) {
          throw new Error("attachment blob missing in IDB — can't replay");
        }
        files.push(new File([blob], att.file_name, { type: att.mime_type }));
      }
      const confirmed = await uploadAndSendMedia({
        id: item.id,
        conversationId: item.conversation_id,
        senderId: item.sender_id,
        caption: item.content,
        files,
        outboxMedia: item.media,
        outboxUserId: userId,
      });
      createdAt = confirmed.created_at;
      mediaForStore = confirmed.media;
      // Clean up the IDB blobs now that they're up.
      removeBlobsForMessage(item.id).catch(() => {});
    } else {
      const confirmed = await sendTextMessage({
        id: item.id,
        conversation_id: item.conversation_id,
        sender_id: item.sender_id,
        content: item.content,
      });
      createdAt = confirmed.created_at;
    }
    console.log("[chat-v2] outbox drain: sent", item.id);
    store.patchMessage(item.conversation_id, item.id, {
      delivery_status: "sent",
      created_at: createdAt,
      ...(mediaForStore ? { media: mediaForStore } : {}),
    });
    removeFromOutbox(userId, item.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[chat-v2] outbox drain: failed", item.id, msg);
    patchOutboxItem(userId, item.id, { last_error: msg });
    store.patchMessage(item.conversation_id, item.id, {
      delivery_status: "failed",
    });
  } finally {
    clearSendInFlight(item.id);
  }
}

// Standalone retry — used by the thread page when the user taps a failed
// bubble. Same single-item send path as drain, just driven manually.
export async function retryOutboxItem(
  userId: string,
  messageId: string
): Promise<void> {
  const items = readOutbox(userId);
  const item = items.find((i) => i.id === messageId);
  if (!item) return;
  await attemptSend(userId, item);
}
