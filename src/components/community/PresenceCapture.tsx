"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { batteryPct } from "@/lib/battery";

// Foreground-only ambient presence (PEJA_MAP_HOME_DESIGN.md §3).
// One tiny upsert on app-open/foreground and every 15 min while open.
// Deliberately NO background tracking: battery drain is the #1 uninstall
// reason for location apps on low-end Androids, and SML already covers
// deliberate live-sharing.

const MIN_WRITE_GAP_MS = 5 * 60 * 1000;
const REFRESH_MS = 15 * 60 * 1000;
const LAST_WRITE_KEY = "peja-presence-written-at";

export function PresenceCapture() {
  const { user } = useAuth();
  const busyRef = useRef(false);

  useEffect(() => {
    if (!user) return;

    const capture = () => {
      if (busyRef.current || document.visibilityState !== "visible") return;
      try {
        const last = Number(localStorage.getItem(LAST_WRITE_KEY) || 0);
        if (Date.now() - last < MIN_WRITE_GAP_MS) return;
      } catch {}
      if (!navigator.geolocation) return;

      busyRef.current = true;
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            // One-shot ambient fix: no filter history to lean on, so just
            // refuse outright junk (distant cell towers). A wrong ambient
            // position is worse than a slightly stale one.
            if ((pos.coords.accuracy ?? 0) > 800) {
              busyRef.current = false;
              return;
            }
            const battery = await batteryPct();
            const { error } = await supabase.from("presence").upsert({
              user_id: user.id,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: pos.coords.accuracy ?? null,
              battery_pct: battery,
              // Ambient capture can't know motion; null these out so a
              // stale speed never rides on this row's fresh captured_at.
              speed_kmh: null,
              heading: null,
              captured_at: new Date().toISOString(),
            });
            if (!error) {
              try { localStorage.setItem(LAST_WRITE_KEY, String(Date.now())); } catch {}
            }
          } finally {
            busyRef.current = false;
          }
        },
        () => { busyRef.current = false; }, // denied/unavailable: silent, never nag here
        { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 15_000 }
      );
    };

    capture();
    const onVisible = () => { if (document.visibilityState === "visible") capture(); };
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(capture, REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [user]);

  return null;
}
