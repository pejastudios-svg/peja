"use client";

// Drain hook for the generic offline outbox at lib/outbox.ts. Watches
// the three "we might be back online" signals and replays the queue:
//
//   • window 'online'             — browser detected network recovery
//   • document 'visibilitychange' — tab/app foregrounded
//   • mount                       — pick up anything queued in a
//                                   previous session if we're already
//                                   online when the app boots
//
// All three flow through one drain() with a re-entrancy lock so
// concurrent triggers don't double-fire the same item. The drain
// itself is FIFO across the user's whole outbox; per-flow ordering
// is preserved because dispatch is sequential.
//
// Mirrors features/chat/useOutboxDrain.ts and
// features/chat/useActionQueueDrain.ts on purpose — same proven
// pattern, just decoupled from the chat store so SOS/SML/posts can
// share it.

import { useEffect, useRef } from "react";
import {
  readOutbox,
  removeFromOutbox,
  patchOutboxItem,
  runOutboxItem,
  MAX_AUTO_ATTEMPTS,
} from "./outbox";

// A stranded item is announced at most once and only while it's still
// FRESH; then it's removed. The old behavior kept dead items in the
// queue forever and re-announced them every session, so one expired
// check-in nagged the user on every single app open.
const STRANDED_ANNOUNCE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function useOutboxDrain(userId: string | null): void {
  const draining = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (typeof window === "undefined") return;

    async function drain() {
      if (draining.current) return;
      // navigator.onLine can lie (says true when actually unreachable),
      // but it's a useful FAST PATH to skip the drain entirely when
      // the browser is confident we're offline. Items that fail
      // because the network is actually down still bump attempts and
      // get retried on the next trigger.
      if (!navigator.onLine) return;
      draining.current = true;
      try {
        const items = readOutbox(userId!);
        for (const item of items) {
          if ((item.attempts ?? 0) >= MAX_AUTO_ATTEMPTS) {
            // Out of retries: this item will never succeed by itself, so
            // remove it. Announce the loss ONLY if it's recent enough for
            // the user to act on ("start the check-in again"); a days-old
            // failure is pure noise.
            console.error("[outbox] item permanently stranded, discarding", item.kind, item.id, item.last_error);
            removeFromOutbox(userId!, item.id);
            if (Date.now() - (item.queued_at ?? 0) < STRANDED_ANNOUNCE_WINDOW_MS) {
              window.dispatchEvent(
                new CustomEvent("peja-outbox-stranded", {
                  detail: { kind: item.kind, id: item.id },
                })
              );
            }
            continue;
          }
          patchOutboxItem(userId!, item.id, {
            attempts: (item.attempts ?? 0) + 1,
          });
          try {
            await runOutboxItem(item);
            removeFromOutbox(userId!, item.id);
            console.log("[outbox] drained", item.kind, item.id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            patchOutboxItem(userId!, item.id, { last_error: msg });
            console.warn("[outbox] drain failed", item.kind, item.id, msg);
          }
        }
      } finally {
        draining.current = false;
      }
    }

    const onOnline = () => {
      console.log("[outbox] online event");
      void drain();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        console.log("[outbox] foregrounded");
        void drain();
      }
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    // Kick on mount in case there's a queued item from a previous
    // session and we're already online.
    void drain();

    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId]);
}
