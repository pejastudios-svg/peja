"use client";

// Listener-only counterpart to useTypingChannel for the conversation
// list page. Subscribes to the `typing:${id}` broadcast channel for
// every conversation in the list so the row can render "typing…" /
// "recording…" without the user having to first open the thread.
//
// We deliberately don't broadcast from here — the list never sends
// typing events, only receives them. That keeps the bandwidth cost
// proportional to the number of OTHER users actively typing, not to
// the number of open channels.
//
// Channels are managed in a per-id map so we can incrementally add or
// remove subscriptions as the conversation list changes (pin / unpin,
// new chat, deleted chat). When the hook unmounts we tear all of them
// down.

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "./store";

export function useListTypingChannels(
  conversationIds: string[],
  userId: string | null
): void {
  // Stable identity for membership comparison — recreating a Set on
  // every render is cheaper than running an effect with array deps
  // (referential changes on every parent render would tear channels
  // down and back up).
  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());

  useEffect(() => {
    if (!userId) {
      // Logged out — tear everything down.
      for (const ch of channelsRef.current.values()) {
        supabase.removeChannel(ch).catch(() => {});
      }
      channelsRef.current.clear();
      return;
    }

    const wanted = new Set(conversationIds);
    const existing = channelsRef.current;

    // Remove channels for conversations no longer in the list.
    for (const [id, ch] of existing) {
      if (!wanted.has(id)) {
        supabase.removeChannel(ch).catch(() => {});
        existing.delete(id);
        useChatStore.getState().clearTyping(id);
      }
    }

    // Add channels for new conversations.
    for (const id of wanted) {
      if (existing.has(id)) continue;
      const ch = supabase.channel(`typing:${id}`, {
        config: { broadcast: { self: false } },
      });
      ch.on("broadcast", { event: "typing" }, ({ payload }) => {
        const sender = payload?.user_id;
        if (typeof sender !== "string" || sender === userId) return;
        useChatStore.getState().setTyping(id, sender, "typing");
      })
        .on("broadcast", { event: "recording" }, ({ payload }) => {
          const sender = payload?.user_id;
          if (typeof sender !== "string" || sender === userId) return;
          useChatStore.getState().setTyping(id, sender, "recording");
        })
        .subscribe();
      existing.set(id, ch);
    }
  }, [conversationIds, userId]);

  // Tear all channels down on unmount.
  useEffect(() => {
    const channels = channelsRef.current;
    return () => {
      for (const ch of channels.values()) {
        supabase.removeChannel(ch).catch(() => {});
      }
      channels.clear();
    };
  }, []);
}
