"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { apiUrl } from "@/lib/api";

/**
 * Lightweight global monitor for safety check-ins.
 * Runs everywhere in the app (mounted in root layout).
 * Polls the check-in status and triggers warnings/expired toasts + notifications.
 * The SafetyCheckIn component on the emergency contacts page handles the full UI.
 */
export function CheckInMonitor() {
  const { session, user } = useAuth();
  const toast = useToast();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCheckRef = useRef<number>(0);

  const getWarned = () => typeof window !== "undefined" && sessionStorage.getItem("peja-checkin-warned") === "true";
  const setWarned = (v: boolean) => { if (typeof window !== "undefined") sessionStorage.setItem("peja-checkin-warned", String(v)); };
  const getExpired = () => typeof window !== "undefined" && sessionStorage.getItem("peja-checkin-expired") === "true";
  const setExpired = (v: boolean) => { if (typeof window !== "undefined") sessionStorage.setItem("peja-checkin-expired", String(v)); };

  const checkStatus = useCallback(async () => {
    if (!session?.access_token || !user) return;

    // Throttle: don't check more than once every 20 seconds
    const now = Date.now();
    if (now - lastCheckRef.current < 20000) return;
    lastCheckRef.current = now;

    try {
      const res = await fetch(apiUrl("/api/checkin/status/"), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (!data.active) {
        // No active check-in, clear any stale flags
        setWarned(false);
        setExpired(false);
        return;
      }

      const checkin = data.checkin;
      if (!checkin) return;

      const target = new Date(checkin.next_check_in_at).getTime();
      const diff = target - Date.now();

      // 5-minute warning
      if (diff > 0 && diff <= 5 * 60 * 1000 && !getWarned()) {
        setWarned(true);
        toast.warning("Check-in expires in less than 5 minutes. Tap 'I'm OK' to reset.");

        // Send warn notification
        fetch(apiUrl("/api/checkin/warn/"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
        }).catch(() => {});
      }

      // Expired
      if (diff <= 0 && !getExpired()) {
        setExpired(true);
        toast.danger("Check-in expired! Your contacts have been notified. Tap 'I'm OK' to confirm you're safe.");
      }
    } catch {}
  }, [session?.access_token, user, toast]);

  useEffect(() => {
    if (!user) return;

    // Check on mount
    checkStatus();

    // Poll every 30 seconds
    intervalRef.current = setInterval(checkStatus, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user, checkStatus]);

  return null;
}