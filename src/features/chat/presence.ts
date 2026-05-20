// Online-presence layer for v2 chat. One global Supabase Realtime
// channel that every signed-in user joins. Each user `.track()`s
// themselves on subscribe; the channel's `presenceState()` gives every
// client a live view of who is currently online.
//
// We deliberately use a single global channel (not per-conversation)
// because:
//   • Per-conversation would mean opening N channels = N WebSocket
//     subscriptions = battery and bandwidth waste for users with many
//     conversations.
//   • The whole point of "who's online" is to be visible *everywhere*
//     in the app — list page, thread page, profile page, anywhere we
//     show an avatar.
//
// Privacy: today, anyone signed into Peja can see anyone's online
// state on this channel. Matches WhatsApp/Telegram defaults. If we
// later add a "Last seen visibility" setting, the filtering happens
// on the client side after presenceState() returns.
//
// Singleton enforcement mirrors realtime.ts — calling start() twice
// for the same user is a no-op; calling for a different user tears
// down the old channel first.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useChatStore } from "./store";

let presenceChannel: RealtimeChannel | null = null;
let presenceUserId: string | null = null;

export async function startPresence(userId: string): Promise<void> {
  if (presenceUserId === userId && presenceChannel) return;

  if (presenceChannel) {
    try {
      await presenceChannel.untrack();
    } catch {}
    try {
      await supabase.removeChannel(presenceChannel);
    } catch {}
    presenceChannel = null;
    presenceUserId = null;
  }

  console.log("[chat-v2] starting presence for user", userId);

  const channel = supabase.channel("peja-presence", {
    config: { presence: { key: userId } },
  });

  channel
    .on("presence", { event: "sync" }, () => {
      // Full state snapshot — each key in the object is a user id, and
      // the value is the array of "metas" (one per active tab/device).
      // We only care which keys are present.
      const state = channel.presenceState() as Record<string, unknown[]>;
      const onlineSet: Record<string, true> = {};
      for (const userKey of Object.keys(state)) {
        onlineSet[userKey] = true;
      }
      useChatStore.getState().setOnlinePresence(onlineSet);
    })
    .on("presence", { event: "leave" }, ({ key }) => {
      // A user (all their tabs/devices) just disconnected. Record the
      // moment as their last-seen so the UI can show "last seen Xm ago"
      // instead of just dropping the dot.
      useChatStore
        .getState()
        .markUserOffline(String(key), new Date().toISOString());
    })
    .subscribe(async (status) => {
      console.log("[chat-v2] presence subscribe status:", status);
      if (status === "SUBSCRIBED") {
        try {
          await channel.track({
            user_id: userId,
            online_at: new Date().toISOString(),
          });
        } catch (e) {
          console.warn("[chat-v2] presence track failed", e);
        }
      }
    });

  presenceChannel = channel;
  presenceUserId = userId;
}

export async function stopPresence(): Promise<void> {
  if (!presenceChannel) return;
  try {
    await presenceChannel.untrack();
  } catch {}
  try {
    await supabase.removeChannel(presenceChannel);
  } catch {}
  presenceChannel = null;
  presenceUserId = null;
}
