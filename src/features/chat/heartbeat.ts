// "Last seen" heartbeat. Periodically updates users.last_seen_at for the
// signed-in user so other clients (who weren't online to witness our
// presence "leave" event) can still render an accurate "last seen 5m
// ago" the next time they fetch their conversation list.
//
// Triggers:
//   • Interval every 30s while the tab is alive AND foregrounded.
//   • visibilitychange → "visible" — runs once on resume to bring the
//     value forward immediately, then the interval picks back up.
//   • online — same idea after a network drop.
//
// We don't write on every keystroke or every message — those are noisy
// and the value only needs minute-grain accuracy to drive "last seen X
// ago" labels. 30 s is a good middle ground (Telegram/WhatsApp behave
// similarly).

import { supabase } from "@/lib/supabase";

const INTERVAL_MS = 30_000;

let intervalId: ReturnType<typeof setInterval> | null = null;
let activeUserId: string | null = null;
let listenersAttached = false;

async function tick(): Promise<void> {
  if (!activeUserId) return;
  // Skip if the tab is hidden — the user isn't actually "here" right now.
  // We'll catch back up via the visibilitychange listener on resume.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }
  try {
    const { error } = await supabase
      .from("users")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", activeUserId);
    if (error) console.warn("[chat-v2] heartbeat update failed", error.message);
  } catch (e) {
    console.warn("[chat-v2] heartbeat update threw", e);
  }
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    void tick();
  }
}

function onOnline() {
  void tick();
}

export function startHeartbeat(userId: string): void {
  if (activeUserId === userId && intervalId) return;
  stopHeartbeat();
  activeUserId = userId;
  // Fire once immediately so the value lands within ~1s of sign-in, not
  // ~30s later. Common case: user comes back, opens chat, sees a friend
  // who was online — that friend's heartbeat should already be fresh.
  void tick();
  intervalId = setInterval(tick, INTERVAL_MS);
  if (typeof window !== "undefined" && !listenersAttached) {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    listenersAttached = true;
  }
}

export function stopHeartbeat(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (typeof window !== "undefined" && listenersAttached) {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
    listenersAttached = false;
  }
  activeUserId = null;
}
