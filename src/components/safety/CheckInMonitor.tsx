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
    checkStatus();
    intervalRef.current = setInterval(checkStatus, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user, checkStatus]);

  // Background location tracking when check-in is active
  const locationWatchRef = useRef<number | null>(null);
  const locationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bgWatcherRef = useRef<string | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!session?.access_token || !user) return;

    const sendLocation = (lat: number, lng: number) => {
      fetch(apiUrl("/api/checkin/location/"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      }).catch(() => {});
    };

    const startTracking = async () => {
      if (activeRef.current) return;
      activeRef.current = true;

      // Try native background geolocation first
      try {
        const { registerPlugin } = await import("@capacitor/core");
        const BackgroundGeolocation = registerPlugin<any>("BackgroundGeolocation");
        bgWatcherRef.current = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: "Peja is tracking your location for safety",
            backgroundTitle: "Location Sharing Active",
            requestPermissions: true,
            stale: false,
            distanceFilter: 10, // meters
          },
          (location: any, error: any) => {
            if (error) return;
            if (location) {
              sendLocation(location.latitude, location.longitude);
            }
          }
        );
        return; // Native tracking started, no need for web fallback
      } catch {
        // Not on native platform, use web fallback
      }

      // Web fallback: watchPosition + polling
      if (!navigator.geolocation) return;

      navigator.geolocation.getCurrentPosition(
        (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );

      locationWatchRef.current = navigator.geolocation.watchPosition(
        (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
        () => {},
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
      );

      locationPollRef.current = setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
        );
      }, 15000);
    };

    const stopTracking = async () => {
      activeRef.current = false;

      // Stop native background tracking
      if (bgWatcherRef.current) {
        try {
          const { registerPlugin } = await import("@capacitor/core");
          const BackgroundGeolocation = registerPlugin<any>("BackgroundGeolocation");
          await BackgroundGeolocation.removeWatcher({ id: bgWatcherRef.current });
          bgWatcherRef.current = null;
        } catch {}
      }

      // Stop web fallback
      if (locationWatchRef.current !== null) {
        navigator.geolocation.clearWatch(locationWatchRef.current);
        locationWatchRef.current = null;
      }
      if (locationPollRef.current) {
        clearInterval(locationPollRef.current);
        locationPollRef.current = null;
      }
    };

    const checkAndTrack = async () => {
      try {
        const res = await fetch(apiUrl("/api/checkin/status/"), {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (data.active && data.checkin) {
          if (!activeRef.current) startTracking();
        } else {
          if (activeRef.current) stopTracking();
        }
      } catch {}
    };

    checkAndTrack();
    const trackInterval = setInterval(checkAndTrack, 30000);

    // Restart tracking when app returns to foreground
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && activeRef.current) {
        // Re-check status and restart if needed
        checkAndTrack();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(trackInterval);
      stopTracking();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [session?.access_token, user]);

  return null;
}