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

    // On app start, check if we have a saved session in native storage
    const { value: savedSession } = await Preferences.get({ key: "peja-auth" });

    if (savedSession) {
      // Check if localStorage already has a session
      const currentSession = localStorage.getItem("peja-auth");

      if (!currentSession || currentSession === "null" || currentSession === "{}") {
        // Restore session from native storage to localStorage
        console.log("[CapacitorInit] Restoring auth session from native storage");
        localStorage.setItem("peja-auth", savedSession);

        // Reload to pick up the restored session
        window.location.reload();
        return;
      }
    }

    // Watch for localStorage changes and sync to native storage
    const syncInterval = setInterval(() => {
      try {
        const session = localStorage.getItem("peja-auth");
        if (session && session !== "null" && session !== "{}") {
          Preferences.set({ key: "peja-auth", value: session });
        }
      } catch {}
    }, 5000); // Sync every 5 seconds

    // Also sync on page visibility change (app going to background)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        try {
          const session = localStorage.getItem("peja-auth");
          if (session && session !== "null" && session !== "{}") {
            Preferences.set({ key: "peja-auth", value: session });
          }
        } catch {}
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Cleanup (though this component never unmounts)
    return () => {
      clearInterval(syncInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  } catch (err) {
    console.warn("[CapacitorInit] Preferences not available:", err);
  }
}