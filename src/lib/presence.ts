// =====================================================
// LEGACY GLOBAL PRESENCE MANAGER — RETIRED
// =====================================================
// This v1 presence system used to open a second "global-presence" channel
// and run its own 60s users.last_seen_at heartbeat for every signed-in
// user, in parallel with the v2 chat presence/heartbeat
// (features/chat/presence.ts + heartbeat.ts). Nothing ever read v1's online
// state (isOnline / onStatusChange / watchUser had no consumers), so it was
// pure duplicate load: a second presence channel per client plus a second
// stream of last_seen writes. Its beforeunload handler also PATCHed the
// users table with the anon key, which is either a silent no-op or a sign
// the row is anon-writable.
//
// The v2 chat system is now the single source of presence + last_seen. This
// stub keeps the old public API so existing callers don't break, but does
// nothing. Do not add logic here — extend the v2 system instead.

type OnlineCallback = (userId: string, isOnline: boolean) => void;

class PresenceManager {
  start(_userId: string) {
    /* retired — see file header */
  }

  stop() {
    /* retired — see file header */
  }

  isOnline(_userId: string): boolean {
    return false;
  }

  onStatusChange(_callback: OnlineCallback): () => void {
    return () => {};
  }

  watchUser(_otherUserId: string): () => void {
    return () => {};
  }
}

export const presenceManager = new PresenceManager();
