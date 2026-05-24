"use client";

import { useEffect } from "react";
import { syncSessionToNative } from "@/lib/supabase";

export function CapacitorInit() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const ua = navigator.userAgent || "";
    const isAndroidWebView = /Android/.test(ua) && /wv/.test(ua);
    const cap = (window as any).Capacitor;
    const isCapacitorBridge = cap !== undefined;
    const isNativePlatform =
      typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;

    // Desktop dev in a normal browser must not get native insets (avoids header growing after load).
    if (!isAndroidWebView && (!isCapacitorBridge || !isNativePlatform)) return;

    // Delete stale SW caches from old versions only
    if ("caches" in window) {
      caches.keys().then((names) => {
        names.forEach((name) => {
          if (name === "peja-v3" || name === "peja-shell-v3" || name === "peja-v2" || name === "peja-shell-v2") {
            caches.delete(name);
          }
        });
      });
    }
    // Force service worker update
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((reg) => reg.update());
      });
    }

    // Hide splash screen now that the app has loaded
import("@capacitor/splash-screen")
  .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 300 }))
  .catch(() => {});

    // Mark native + apply top inset in one step so the header does not jump
    // (compact first paint → tall after hydration).
    const applyNativeChrome = async () => {
      let statusBarPx = 0;

      try {
        const { StatusBar } = await import("@capacitor/status-bar");
        const info = await (StatusBar as any).getInfo();
        statusBarPx = info?.statusBarHeight || 0;
      } catch {}

      if (statusBarPx <= 0) {
        const screenH = window.screen.height;
        const innerH = window.innerHeight;
        const gap = screenH - innerH;
        if (gap > 48) {
          statusBarPx = Math.min(Math.max(gap - 48, 24), 48);
        }
      }

      const root = document.documentElement;
      root.classList.add("capacitor-native");

      if (statusBarPx > 0) {
        root.style.setProperty("--cap-status-bar-height", `${statusBarPx}px`);
        root.classList.add("has-top-chrome");
      } else {
        const envProbe = document.createElement("div");
        envProbe.style.cssText =
          "position:fixed;top:0;height:env(safe-area-inset-top,0px);width:0;visibility:hidden;";
        document.body.appendChild(envProbe);
        const envInset = envProbe.getBoundingClientRect().height;
        document.body.removeChild(envProbe);
        if (envInset > 0) {
          root.classList.add("has-top-chrome");
        }
      }
    };

    void applyNativeChrome();

    // Set bottom inset for Android gesture navigation
    // env(safe-area-inset-bottom) often returns 0 on Android WebViews,
    // so we detect gesture navigation and set a manual fallback
    const detectBottomInset = () => {
      // Check if env(safe-area-inset-bottom) actually returns a value
      const testEl = document.createElement("div");
      testEl.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
      document.body.appendChild(testEl);
      const computed = window.getComputedStyle(testEl).paddingBottom;
      document.body.removeChild(testEl);

      const envValue = parseInt(computed, 10) || 0;

      if (envValue > 0) {
        // env() works correctly, use it
        document.documentElement.style.setProperty(
          "--cap-bottom-inset",
          `${envValue}px`
        );
      } else {
        // env() returned 0 — likely Android gesture nav not reporting insets
        // Check screen vs viewport height difference as a heuristic
        const screenH = window.screen.height;
        const innerH = window.innerHeight;
        const statusBar = 36;
        const diff = screenH - innerH - statusBar;

        // If there's a significant gap, there's probably a gesture bar
        if (diff > 20) {
          document.documentElement.style.setProperty(
            "--cap-bottom-inset",
            "16px"
          );
        } else {
          document.documentElement.style.setProperty(
            "--cap-bottom-inset",
            "0px"
          );
        }
      }
    };

    // Run after a short delay to let the WebView settle
    setTimeout(detectBottomInset, 500);

    // Status bar background/style is driven by ThemeContext so it reflects
    // the current light/dark preference (not hard-coded to dark here).

    // Start continuous session sync to native storage
    startSessionSync();

    // Setup deep link listener
    setupDeepLinkListener();

  }, []);

  return null;
}

// =====================================================
// SESSION SYNC (localStorage → Native Preferences)
// =====================================================
function startSessionSync() {
  // Sync every 5 seconds
  setInterval(() => {
    syncSessionToNative();
  }, 5000);

  // Sync when app goes to background
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      syncSessionToNative();
    }
  });

  // Sync before page unload
  window.addEventListener("pagehide", () => {
    syncSessionToNative();
  });
}

// =====================================================
// DEEP LINK HANDLER
// =====================================================
async function setupDeepLinkListener() {
  try {
    const { App } = await import("@capacitor/app");

    App.addListener("appUrlOpen", (event) => {

      let path: string | null = null;

      try {
        const url = new URL(event.url);
        if (
url.hostname === "peja.life" ||
          url.hostname === "www.peja.life" ||
          url.hostname === "peja.vercel.app"
        ) {
          path = url.pathname + url.search + url.hash;
        }
      } catch {
        if (event.url.startsWith("peja://")) {
          const afterScheme = event.url.replace("peja://app", "");
          path = afterScheme || "/";
        }
      }

      if (path && path !== window.location.pathname) {
        window.location.assign(path);
      }
    });
  } catch (err) {
  }
}
