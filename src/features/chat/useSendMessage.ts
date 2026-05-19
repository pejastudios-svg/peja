"use client";

// Send hook. Mirrors the UUID-based optimistic pattern: the client
// generates the UUID, inserts the message into the store as "pending",
// then awaits Supabase confirm. The same UUID is the row's primary key
// in the DB, so when the realtime INSERT event fires it merges into the
// already-present store entry by id — no temp→real swap dance.

import { useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useChatStore } from "./store";
import { sendTextMessage } from "./api";

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

      // 2. Wait for the server. On success, transition to "sent". The
      //    realtime INSERT will also fire for this row and upsertMessage
      //    will merge — but our local entry is already authoritative
      //    via the UUID.
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
      } catch (err) {
        console.error("[chat-v2] send failed", err);
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
