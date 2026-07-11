"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { authFetchJson } from "@/lib/authFetch";
import { supabase } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";

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
    if (!user) return;

    // Throttle: don't check more than once every 20 seconds
    const now = Date.now();
    if (now - lastCheckRef.current < 20000) return;
    lastCheckRef.current = now;

    try {
      const { res, data } = await authFetchJson("/api/checkin/status/");

      // Error responses (auth hiccup, 5xx) are not "no check-in" —
      // leave the warned/expired flags alone and try again next poll.
      if (!res.ok) return;

      if (data?.active === false) {
        // No active check-in, clear any stale flags
        setWarned(false);
        setExpired(false);
        return;
      }

      const checkin = data?.checkin;
      if (!checkin) return;

      const target = new Date(checkin.next_check_in_at).getTime();
      const diff = target - Date.now();

// 5-minute warning
      if (diff > 0 && diff <= 5 * 60 * 1000 && !getWarned()) {
        setWarned(true);
        toast.warning("Check-in expires in less than 5 minutes. Tap 'I'm OK' to reset.");
        // Send warn notification to contacts
        authFetchJson("/api/checkin/warn/", { method: "POST" }).catch(() => {});
        // Push notification to the user
        createNotification({
          userId: user.id,
          type: "system",
          title: "Check-in expiring soon",
          body: "Your safety check-in expires in less than 5 minutes. Tap 'I'm OK' to reset.",
          data: { type: "safety_checkin_warning" },
        }).catch(() => {});
      }
      // Expired
      if (diff <= 0 && !getExpired()) {
        setExpired(true);
        toast.danger("Check-in expired! Your contacts have been notified. Tap 'I'm OK' to confirm you're safe.");
        // Push notification to the user
        createNotification({
          userId: user.id,
          type: "system",
          title: "Check-in expired!",
          body: "Your contacts have been notified. Open Peja and tap 'I'm OK' to confirm you're safe.",
          data: { type: "safety_checkin_self_expired" },
        }).catch(() => {});
      }
    } catch {}
  }, [user, toast]);

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
  const activeRef = useRef(false);
  // Keep the latest access token in a ref so the tracking lifecycle does NOT
  // depend on it. The Supabase token rotates periodically; if the effect were
  // keyed on it, every rotation would tear down and restart the native
  // foreground service (flickering notification, and a dead service whenever a
  // rotation lands while backgrounded). The service is self-sufficient — start
  // it once per check-in and only stop it when the check-in ends.
  const tokenRef = useRef<string | undefined>(session?.access_token);
  const checkAndTrackRef = useRef<() => void>(() => {});

  useEffect(() => {
    tokenRef.current = session?.access_token;
    // Push a refreshed token to the already-running native service so a long
    // check-in (up to 4h) keeps authenticating after the original token
    // expires (~1h) — WITHOUT restarting the service.
    if (activeRef.current && session?.access_token) {
      const isCapacitor = typeof (window as any).Capacitor !== "undefined";
      if (isCapacitor) {
        import("@/lib/smlLocation")
          .then(({ default: SMLLocation }) =>
            SMLLocation.updateToken?.({ accessToken: session.access_token })
          )
          .catch(() => {});
      }
    }
    // If we just got a token (e.g. it arrived after mount), kick a re-check so
    // tracking can start without waiting for the next poll.
    checkAndTrackRef.current();
  }, [session?.access_token]);

  useEffect(() => {
    if (!user?.id) return;

    const sendLocation = (lat: number, lng: number) => {
      authFetchJson("/api/checkin/location/", {
        method: "POST",
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      }).catch(() => {});
    };

    const startTracking = async (checkinId: string) => {
      if (activeRef.current) return;
      // Fresh token for the native service — the ref can hold a stale
      // one right after app-resume. getSession() refreshes if needed.
      let token = tokenRef.current;
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (sess.session?.access_token) token = sess.session.access_token;
      } catch {}
      if (!token) return;
      activeRef.current = true;

      // Native Android foreground service first. Mirrors the SOS pattern:
      // SMLLocationService runs a FusedLocationProviderClient at strict 15s
      // cadence, no distance filter, PATCHing safety_checkins directly. The
      // ongoing notification ("Location Sharing Active") is mandatory under
      // Android 10+ foreground-service rules.
      try {
        const isCapacitor = typeof (window as any).Capacitor !== "undefined";
        if (isCapacitor) {
          const { default: SMLLocation } = await import("@/lib/smlLocation");
          await SMLLocation.startTracking({
            checkinId,
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
            supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
            accessToken: token,
          });
          return;
        }
      } catch {
        // Plugin not available or failed — drop through to web fallback.
      }

      // Web fallback: watchPosition + polling. Only fires while the WebView
      // is in the foreground — browsers don't support real background tracking.
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

      // Stop native foreground service
      try {
        const isCapacitor = typeof (window as any).Capacitor !== "undefined";
        if (isCapacitor) {
          const { default: SMLLocation } = await import("@/lib/smlLocation");
          await SMLLocation.stopTracking();
        }
      } catch {}

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
        const { res, data } = await authFetchJson("/api/checkin/status/");
        if (res.ok && data?.active && data.checkin) {
          // A foreground service can only be started while the app is
          // visible (Android 12+ blocks background FGS starts). If we're
          // backgrounded, defer — the visibilitychange handler restarts
          // tracking the moment the app returns to the foreground.
          if (!activeRef.current && document.visibilityState === "visible") {
            startTracking(data.checkin.id);
          }
        } else if (res.ok && data?.active === false) {
          // Only an explicit "no active check-in" stops tracking. A
          // transient error (auth hiccup, 5xx) must NEVER tear down the
          // foreground location service mid-share — that silently stops
          // sharing for a user who believes they are protected.
          if (activeRef.current) stopTracking();
        }
      } catch {}
    };

    checkAndTrackRef.current = () => { void checkAndTrack(); };

    checkAndTrack();
    const trackInterval = setInterval(checkAndTrack, 30000);

    // Restart tracking when app returns to foreground
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // Re-check status and start tracking if a check-in is active. This is
        // also where tracking starts when the app was backgrounded at the
        // moment the check-in became active (a foreground service can't be
        // started from the background).
        checkAndTrack();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(trackInterval);
      stopTracking();
      document.removeEventListener("visibilitychange", handleVisibility);
      checkAndTrackRef.current = () => {};
    };
  }, [user?.id]);

  return null;
}