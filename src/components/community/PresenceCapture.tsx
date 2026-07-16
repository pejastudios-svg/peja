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
            // Ambient one-shot fixes are the jumpy kind (cold GPS falls
            // back to cell/Wi-Fi, hundreds of meters off). Persistent
            // filter via localStorage since each capture is a fresh run:
            //  - coarse fixes (>200m) only pass after 15 min blind
            //    (stale-good beats fresh-garbage for ambient)
            //  - >800m never passes
            //  - teleports (>300 km/h vs last write) with WORSE accuracy
            //    than the last fix are noise, not movement
            const acc = pos.coords.accuracy ?? 100;
            if (acc > 800) { busyRef.current = false; return; }
            try {
              const lastRaw = localStorage.getItem("peja-ambient-last-fix");
              const last = lastRaw ? JSON.parse(lastRaw) : null;
              const blindMs = last ? Date.now() - last.t : Infinity;
              if (acc > 200 && blindMs < 15 * 60_000) {
                busyRef.current = false;
                return;
              }
              if (last && blindMs < 30 * 60_000) {
                const R = 6371000;
                const dLat = ((pos.coords.latitude - last.lat) * Math.PI) / 180;
                const dLng = ((pos.coords.longitude - last.lng) * Math.PI) / 180;
                const h =
                  Math.sin(dLat / 2) ** 2 +
                  Math.cos((last.lat * Math.PI) / 180) *
                    Math.cos((pos.coords.latitude * Math.PI) / 180) *
                    Math.sin(dLng / 2) ** 2;
                const distM = 2 * R * Math.asin(Math.sqrt(h));
                const kmh = (distM / Math.max(1, blindMs / 1000)) * 3.6;
                if (kmh > 300 && acc > (last.acc ?? 100)) {
                  busyRef.current = false;
                  return;
                }
              }
              localStorage.setItem(
                "peja-ambient-last-fix",
                JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now(), acc })
              );
            } catch {}
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
