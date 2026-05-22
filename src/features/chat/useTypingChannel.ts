"use client";

// Per-conversation typing + recording indicator. One Supabase Realtime
// broadcast channel scoped to a single conversation while the user
// is on the thread page. Closed on unmount.
//
// Why a dedicated channel (vs. piggybacking on the existing message
// channel or the presence channel):
//   • Privacy — events are visible only to the other participant of
//     THIS conversation, not to every signed-in user.
//   • Lifecycle — the channel exists exactly while the thread is open.
//     Drops cleanly when the user navigates away.
//   • Volume — typing fires at ~1/sec while a user is actively typing.
//     Recording fires at the same rate while a voice note is being
//     recorded. Both stay on the same channel since their UX is
//     mutually exclusive (you can't type and record at the same time).
//
// API:
//   const { sendTyping, sendRecording } = useTypingChannel(cid, uid);
//
// The caller invokes the appropriate function periodically; the hook
// throttles each to ~1 broadcast per 1.5 s. Receivers write to the
// store via setTyping(_, _, kind), and a 3 s TTL timer (scheduled
// inside the store action) wipes the entry if no further events
// arrive.

import { useCallback, useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "./store";

const TYPING_THROTTLE_MS = 1_500;

export function useTypingChannel(
  conversationId: string | null,
  userId: string | null
): { sendTyping: () => void; sendRecording: () => void } {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!conversationId || !userId) return;

    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    });

    // Both events route to the same store action with a different
    // kind. The store handles the 3 s TTL.
    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const sender = payload?.user_id;
        if (typeof sender !== "string" || sender === userId) return;
        useChatStore.getState().setTyping(conversationId, sender, "typing");
      })
      .on("broadcast", { event: "recording" }, ({ payload }) => {
        const sender = payload?.user_id;
        if (typeof sender !== "string" || sender === userId) return;
        useChatStore.getState().setTyping(conversationId, sender, "recording");
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      useChatStore.getState().clearTyping(conversationId);
      supabase.removeChannel(channel).catch(() => {});
      channelRef.current = null;
    };
  }, [conversationId, userId]);

  const sendKind = useCallback(
    (event: "typing" | "recording") => {
      if (!channelRef.current || !userId) return;
      const now = Date.now();
      if (now - lastSentRef.current < TYPING_THROTTLE_MS) return;
      lastSentRef.current = now;
      channelRef.current.send({
        type: "broadcast",
        event,
        payload: { user_id: userId },
      });
    },
    [userId]
  );

  // Pre-bound stable callbacks so callers can pass them to event
  // handlers without re-rendering the channel subscriber.
  const sendTyping = useCallback(() => sendKind("typing"), [sendKind]);
  const sendRecording = useCallback(() => sendKind("recording"), [sendKind]);

  return { sendTyping, sendRecording };
}
