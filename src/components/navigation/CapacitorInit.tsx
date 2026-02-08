"use client";

import { useEffect } from "react";

export function CapacitorInit() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const ua = navigator.userAgent || "";
    const isAndroidWebView = /Android/.test(ua) && /wv/.test(ua);
    const isCapacitorBridge = (window as any).Capacitor !== undefined;

    if (!isAndroidWebView && !isCapacitorBridge) return;

    // Mark the document
    document.documentElement.classList.add("capacitor-native");

    // Set status bar height
    document.documentElement.style.setProperty(
      "--cap-status-bar-height",
      "36px"
    );

    // Style the status bar
    import("@capacitor/status-bar")
      .then(({ StatusBar }) => {
        StatusBar.setBackgroundColor({ color: "#0c0818" }).catch(() => {});
      })
      .catch(() => {});

    // Persist auth session using native storage
    persistAuthSession();
  }, []);

  return null;
}

async function persistAuthSession() {
  try {
    const { Preferences } = await import("@capacitor/preferences");

    const AUTH_KEY = "peja-auth";
    const NATIVE_KEY = "peja-auth-backup";

    // Step 1: Check if localStorage has a valid session
    const currentSession = localStorage.getItem(AUTH_KEY);
    const hasValidSession =
      currentSession &&
      currentSession !== "null" &&
      currentSession !== "{}" &&
      currentSession.length > 10;

    if (hasValidSession) {
      // Save to native storage immediately
      await Preferences.set({ key: NATIVE_KEY, value: currentSession });
      console.log("[Auth] Session backed up to native storage");
    } else {
      // No valid session in localStorage — try to restore from native
      const { value: savedSession } = await Preferences.get({
        key: NATIVE_KEY,
      });

      if (
        savedSession &&
        savedSession !== "null" &&
        savedSession !== "{}" &&
        savedSession.length > 10
      ) {
        console.log("[Auth] Restoring session from native storage");
        localStorage.setItem(AUTH_KEY, savedSession);

        // Give Supabase a moment to pick it up, then reload
        setTimeout(() => {
          window.location.reload();
        }, 100);
        return; // Stop here, page will reload
      }
    }

    // Step 2: Continuously sync localStorage to native storage
    // Use both interval and visibility change for maximum reliability
    const syncToNative = async () => {
      try {
        const session = localStorage.getItem(AUTH_KEY);
        if (session && session !== "null" && session !== "{}" && session.length > 10) {
          await Preferences.set({ key: NATIVE_KEY, value: session });
        }
      } catch {}
    };

    // Sync every 3 seconds
    const interval = setInterval(syncToNative, 3000);

    // Sync when app goes to background
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        syncToNative();
      }
    });

    // Sync before page unload
    window.addEventListener("beforeunload", () => {
      syncToNative();
    });

    // Sync on pagehide (more reliable on mobile)
    window.addEventListener("pagehide", () => {
      syncToNative();
    });
  } catch (err) {
    console.warn("[Auth] Native persistence not available:", err);
  }
}