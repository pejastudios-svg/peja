"use client";

// Send hook. Mirrors the UUID-based optimistic pattern: the client
// generates the UUID, inserts the message into the store as "pending",
// then awaits Supabase confirm. The same UUID is the row's primary key
// in the DB, so when the realtime INSERT event fires it merges into the
// already-present store entry by id — no temp→real swap dance.
//
// Phase 2: every send is also written to a persistent outbox in
// localStorage *before* the network call. If the browser is offline, or
// the call fails, the item stays in the outbox and gets retried on the
// next online / foreground / SUBSCRIBED event (see useOutboxDrain).
// Reload-safe: even a hard refresh mid-send won't lose the message.

import { useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "./store";
import { sendTextMessage } from "./api";
import { addToOutbox, patchOutboxItem, removeFromOutbox } from "./outbox";

export function useSendMessage() {
  const { user } = useAuth();

  const send = useCallback(
    async (conversationId: string, content: string) => {
      const trimmed = content.trim();
      if (!user?.id || !trimmed) return;

      // UUIDv4 generated client-side. Crypto.randomUUID is available on
      // all browsers we support (and on Capacitor WebView via the
      // global crypto API). Falls back to a Math.random-based generator
      // only if for some reason crypto is unavailable.
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : fallbackUuid();

      const store = useChatStore.getState();

      // Optimistic timestamp = max(device clock, last-known-message + 1ms).
      // The +1ms guarantee places the optimistic at the END of the array
      // even when the device clock is skewed relative to the Supabase
      // server clock. Without this, a phone whose clock is a few seconds
      // behind would optimistically position its own send *before* the
      // last message it just received via realtime — looking like the
      // outgoing message arrived before incoming ones. After the server
      // confirms the insert we patch the timestamp to the authoritative
      // value, and the store resorts.
      const existingMessages = store.threadsByConversation[conversationId]?.messages || [];
      const lastTime = existingMessages.length
        ? new Date(existingMessages[existingMessages.length - 1].created_at).getTime()
        : 0;
      const optimisticTime = new Date(Math.max(Date.now(), lastTime + 1)).toISOString();

      // 1. Optimistic add — the message appears immediately with
      //    "pending" status. The bubble shows a clock or single check,
      //    UI's choice.
      store.upsertMessage(conversationId, {
        id,
        conversation_id: conversationId,
        sender_id: user.id,
        content: trimmed,
        content_type: "text",
        created_at: optimisticTime,
        edited_at: null,
        is_deleted: false,
        reply_to_id: null,
        delivery_status: "pending",
      });

      // Local-only optimistic preview bump so the conversation list
      // reorders immediately. The DB trigger will fire its own
      // conversation row UPDATE (delivered via realtime) shortly,
      // overriding this with the authoritative server value.
      store.bumpConversation(conversationId, {
        last_message_text: trimmed.slice(0, 100),
        last_message_at: optimisticTime,
        last_message_sender_id: user.id,
      });

      // 2. Persist to the outbox BEFORE the network call. If we lose
      //    connectivity or the tab crashes between here and the await
      //    below, this is what saves the message — useOutboxDrain will
      //    pick it up on the next online / foreground / reconnect event.
      addToOutbox(user.id, {
        id,
        conversation_id: conversationId,
        sender_id: user.id,
        content: trimmed,
        created_at: optimisticTime,
        attempts: 0,
        last_error: null,
      });

      // If the browser knows it's offline, don't even attempt the send.
      // The outbox holds the message; drain will replay it when 'online'
      // fires. Status stays "pending" so the UI shows the clock indicator
      // (we'll add a queue-specific indicator in a UI polish pass).
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        console.log("[chat-v2] offline — message queued", { id, conversationId });
        return;
      }

      // 3. Attempt the send. On success, transition to "sent" and drop
      //    the outbox item. On failure (network or server), keep the
      //    outbox item and flip the message to "failed" so the user
      //    sees the retry affordance.
      console.log("[chat-v2] sending message", { id, conversationId, content: trimmed });
      try {
        const confirmed = await sendTextMessage({
          id,
          conversation_id: conversationId,
          sender_id: user.id,
          content: trimmed,
        });
        console.log("[chat-v2] send confirmed", { id, created_at: confirmed.created_at });
        store.patchMessage(conversationId, id, {
          delivery_status: "sent",
          created_at: confirmed.created_at,
        });
        removeFromOutbox(user.id, id);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[chat-v2] send failed", err);
        patchOutboxItem(user.id, id, {
          attempts: 1,
          last_error: errMsg,
        });
        store.patchMessage(conversationId, id, {
          delivery_status: "failed",
        });
        throw err;
      }
    },
    [user?.id]
  );

  return send;
}

function fallbackUuid(): string {
  // RFC4122-ish v4 — not crypto-safe but unique enough for client ids.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
