"use client";

// Drain hook for the offline action queue (actionQueue.ts). Watches
// the same trio of "we might be back" signals as useOutboxDrain:
//
//   • window 'online'              — browser detected network recovery
//   • document 'visibilitychange'  — app foregrounded
//   • Realtime SUBSCRIBED          — Supabase channel reconnected
//                                    (lastConnectedAt in the store)
//
// All three trip the same drain pass. Drain replays each queued
// action in FIFO order; success removes it, failure bumps attempts
// and leaves it in the queue until the user manually retries (or
// the next trigger fires).

import { useEffect, useRef } from "react";
import { useChatStore } from "./store";
import {
  readActions,
  removeAction,
  patchAction,
  runChatAction,
  MAX_AUTO_RETRIES,
} from "./actionQueue";

export function useActionQueueDrain(userId: string | null): void {
  const lastConnectedAt = useChatStore((s) => s.lastConnectedAt);
  const draining = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (typeof window === "undefined") return;

    async function drain() {
      if (draining.current) return;
      if (!navigator.onLine) return;
      draining.current = true;
      try {
        const items = readActions(userId!);
        for (const item of items) {
          if ((item.attempts ?? 0) >= MAX_AUTO_RETRIES) continue;
          patchAction(userId!, item.id, { attempts: (item.attempts ?? 0) + 1 });
          try {
            await runChatAction(item);
            removeAction(userId!, item.id);
            console.log("[chat-v2] action queue drain: applied", item.kind, item.id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            patchAction(userId!, item.id, { last_error: msg });
            console.warn(
              "[chat-v2] action queue drain: failed",
              item.kind,
              item.id,
              msg
            );
          }
        }
      } finally {
        draining.current = false;
      }
    }

    const onOnline = () => {
      console.log("[chat-v2] action queue drain: online event");
      void drain();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        console.log("[chat-v2] action queue drain: foregrounded");
        void drain();
      }
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    // Kick once on mount + whenever lastConnectedAt changes (Realtime
    // reconnect signal).
    void drain();

    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, lastConnectedAt]);
}
