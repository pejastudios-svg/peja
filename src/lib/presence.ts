import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

// =====================================================
// GLOBAL PRESENCE MANAGER
// Handles: online status, last_seen_at updates
// Uses Supabase Presence for real-time + DB fallback
// =====================================================

type OnlineCallback = (userId: string, isOnline: boolean) => void;

class PresenceManager {
  private globalChannel: RealtimeChannel | null = null;
  private chatChannels: Map<string, RealtimeChannel> = new Map();
  private onlineUsers: Set<string> = new Set();
  private listeners: Set<OnlineCallback> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private userId: string | null = null;
  private started = false;

  // -------------------------------------------------
  // START — call once after login
  // -------------------------------------------------
  start(userId: string) {
    if (this.started && this.userId === userId) return;
    this.stop(); // clean up any previous

    this.userId = userId;
    this.started = true;

    // 1. Join a global presence channel so others can see us
    this.globalChannel = supabase.channel("global-presence", {
      config: { presence: { key: userId } },
    });

    this.globalChannel
      .on("presence", { event: "sync" }, () => {
        const state = this.globalChannel!.presenceState();
        const nowOnline = new Set(Object.keys(state));

        // Detect who came online / went offline
        for (const uid of nowOnline) {
          if (!this.onlineUsers.has(uid)) {
            this.onlineUsers.add(uid);
            this.notifyListeners(uid, true);
          }
        }
        for (const uid of this.onlineUsers) {
          if (!nowOnline.has(uid)) {
            this.onlineUsers.delete(uid);
            this.notifyListeners(uid, false);
          }
        }
      })
      .on("presence", { event: "join" }, ({ key }) => {
        if (key) {
          this.onlineUsers.add(key);
          this.notifyListeners(key, true);
        }
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        if (key) {
          this.onlineUsers.delete(key);
          this.notifyListeners(key, false);
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await this.globalChannel!.track({ online_at: new Date().toISOString() });
        }
      });

    // 2. Heartbeat: update last_seen_at in DB every 60s (fallback)
    this.updateLastSeen();
    this.heartbeatInterval = setInterval(() => {
      this.updateLastSeen();
    }, 60_000);

    // 3. Update on visibility change
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibility);
      window.addEventListener("beforeunload", this.handleUnload);
    }
  }

  // -------------------------------------------------
  // STOP — call on logout
  // -------------------------------------------------
  stop() {
    this.started = false;
    this.userId = null;

    if (this.globalChannel) {
      supabase.removeChannel(this.globalChannel);
      this.globalChannel = null;
    }

    this.chatChannels.forEach((ch) => supabase.removeChannel(ch));
    this.chatChannels.clear();

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.onlineUsers.clear();

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibility);
      window.removeEventListener("beforeunload", this.handleUnload);
    }
  }

  // -------------------------------------------------
  // CHECK IF USER IS ONLINE
  // -------------------------------------------------
  isOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  // -------------------------------------------------
  // SUBSCRIBE TO ONLINE/OFFLINE CHANGES
  // -------------------------------------------------
  onStatusChange(callback: OnlineCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  // -------------------------------------------------
  // SUBSCRIBE TO A SPECIFIC USER'S PRESENCE
  // Used in chat view to watch the other user
  // -------------------------------------------------
  watchUser(otherUserId: string): () => void {
    // The global channel already tracks everyone, but this
    // provides an immediate check + callback pattern
    const isCurrentlyOnline = this.onlineUsers.has(otherUserId);

    // Return unsubscribe function
    return () => {
      // No special cleanup needed — global channel handles it
    };
  }

  // -------------------------------------------------
  // PRIVATE HELPERS
  // -------------------------------------------------
  private notifyListeners(userId: string, isOnline: boolean) {
    this.listeners.forEach((cb) => {
      try {
        cb(userId, isOnline);
      } catch (e) {
        console.error("[Presence] Listener error:", e);
      }
    });
  }

  private async updateLastSeen() {
    if (!this.userId) return;
    try {
      await supabase
        .from("users")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", this.userId);
    } catch (e) {
      // Silent fail — non-critical
    }
  }

  private handleVisibility = () => {
    if (!this.userId || !this.globalChannel) return;

    if (document.visibilityState === "visible") {
      // Re-track as online
      this.globalChannel.track({ online_at: new Date().toISOString() });
      this.updateLastSeen();
    } else {
      // Untrack — will show as offline after presence timeout
      this.globalChannel.untrack();
      this.updateLastSeen();
    }
  };

  private handleUnload = () => {
    // Best-effort last_seen update via sendBeacon
    if (!this.userId) return;
    try {
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/users?id=eq.${this.userId}`;
      const body = JSON.stringify({ last_seen_at: new Date().toISOString() });
      navigator.sendBeacon(
        url,
        new Blob([body], { type: "application/json" })
      );
    } catch {
      // Silent fail
    }
  };
}

export const presenceManager = new PresenceManager();