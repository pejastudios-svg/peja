"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import {
  AMBIENT_CHANGED_EVENT,
  AMBIENT_KEY_STORAGE,
  AMBIENT_PREF_KEY,
  AmbientLocation,
  isCapacitor,
} from "@/lib/ambientTracker";

// Lifecycle manager for the always-on tracker (Android app only).
// Responsibilities:
//  - when enabled + logged in: ensure a device key exists (mint once)
//    and (re)start the native service - also heals the Android 14 case
//    where the boot receiver couldn't restart it after a reboot.
//  - when disabled: stop the service and revoke the key server-side.
//  - on logout: the key is revoked by the next beat 401ing (the service
//    stops itself), and we stop it proactively here too.

export function AmbientTrackerBootstrap() {
  const { user } = useAuth();
  const busy = useRef(false);

  useEffect(() => {
    if (!isCapacitor()) return;

    const sync = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        let pref: string | null = null;
        try { pref = localStorage.getItem(AMBIENT_PREF_KEY); } catch {}

        if (!user || pref !== "on") {
          // Disabled or logged out: make sure the service is down.
          const { tracking } = await AmbientLocation.isTracking().catch(() => ({ tracking: false }));
          if (tracking) await AmbientLocation.stop().catch(() => {});
          return;
        }

        // Enabled: mint the device key once, then (re)start the service.
        let key: string | null = null;
        try { key = localStorage.getItem(AMBIENT_KEY_STORAGE); } catch {}
        if (!key) {
          const { res, data } = await authFetchJson("/api/presence/tracker-key", { method: "POST" });
          if (!res.ok || !data?.key) return; // try again next sync
          key = data.key as string;
          try { localStorage.setItem(AMBIENT_KEY_STORAGE, key); } catch {}
        }
        await AmbientLocation.start({
          endpoint: `${window.location.origin}/api/presence/beat`,
          key,
        }).catch(() => {});
      } finally {
        busy.current = false;
      }
    };

    sync();
    const onChanged = () => { sync(); };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener(AMBIENT_CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(AMBIENT_CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user]);

  return null;
}

/** Settings toggle helper: flips the pref, revokes on disable, notifies
 * the bootstrap. Returns the new state. */
export async function setAmbientTracking(on: boolean): Promise<boolean> {
  try { localStorage.setItem(AMBIENT_PREF_KEY, on ? "on" : "off"); } catch {}
  if (!on) {
    try { localStorage.removeItem(AMBIENT_KEY_STORAGE); } catch {}
    // Revoke server-side so a leaked key is dead, then stop the service.
    authFetchJson("/api/presence/tracker-key", { method: "DELETE" }).catch(() => {});
    if (isCapacitor()) await AmbientLocation.stop().catch(() => {});
  }
  try { window.dispatchEvent(new Event(AMBIENT_CHANGED_EVENT)); } catch {}
  return on;
}
