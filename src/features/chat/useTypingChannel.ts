"use client";

// Per-conversation typing indicator. Opens a Supabase Realtime
// "broadcast" channel scoped to a single conversation while the user
// is on the thread page. Closed on unmount.
//
// Why a dedicated channel (vs. piggybacking on the existing message
// channel or the presence channel):
//   • Privacy — typing events are visible only to the other
//     participant of THIS conversation, not to every signed-in user.
//   • Lifecycle — the channel exists exactly while the thread is open.
//     Drops cleanly when the user navigates away.
//   • Volume — typing fires at ~1/sec while a user is actively typing.
//     Keeping it on its own channel makes the noise easy to reason
//     about and trivial to throttle.
//
// API:
//   useTypingChannel(conversationId, userId) → sendTyping()
//
// Caller invokes sendTyping() on each keystroke. The hook throttles to
// ~1 broadcast per 1.5 s. Receivers in the same conversation see the
// event, write it to the store via setTyping(), and a 3 s TTL timer
// (scheduled inside the store action) wipes the entry if no further
// events arrive.

import { useCallback, useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "./store";

const TYPING_THROTTLE_MS = 1_500;

export function useTypingChannel(
  conversationId: string | null,
  userId: string | null
): () => void {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!conversationId || !userId) return;

    const channel = supabase.channel(`typing:${conversationId}`, {
      // Receive your own broadcasts? No — we filter self anyway, and
      // self-receive would just double the event handler traffic.
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const sender = payload?.user_id;
        if (typeof sender !== "string") return;
        if (sender === userId) return; // belt-and-braces self filter
        useChatStore.getState().setTyping(conversationId, sender);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      // Drop the indicator immediately on unmount so the other party
      // doesn't see a phantom "typing…" linger after we left the screen.
      useChatStore.getState().clearTyping(conversationId);
      supabase.removeChannel(channel).catch(() => {});
      channelRef.current = null;
    };
  }, [conversationId, userId]);

  const sendTyping = useCallback(() => {
    if (!channelRef.current || !userId) return;
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_THROTTLE_MS) return;
    lastSentRef.current = now;
    channelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: userId },
    });
  }, [userId]);

  return sendTyping;
}
