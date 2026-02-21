"use client";

import { useEffect, useState } from "react";
import { syncSessionToNative } from "@/lib/supabase";
import { OfflineScreen } from "@/components/system/OfflineScreen";

export function CapacitorInit() {
  const [isOffline, setIsOffline] = useState(false);
  const [isCapacitor, setIsCapacitor] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const ua = navigator.userAgent || "";
    const isAndroidWebView = /Android/.test(ua) && /wv/.test(ua);
    const isCapacitorBridge = (window as any).Capacitor !== undefined;

    if (!isAndroidWebView && !isCapacitorBridge) return;

    setIsCapacitor(true);

    // Mark the document for CSS targeting
    document.documentElement.classList.add("capacitor-native");

    // Set status bar height dynamically
    const setStatusBarHeight = async () => {
      try {
        const { StatusBar } = await import("@capacitor/status-bar");
        const info = await (StatusBar as any).getInfo();
        const height = info?.statusBarHeight || 0;
        if (height > 0) {
          document.documentElement.style.setProperty(
            "--cap-status-bar-height",
            `${height}px`
          );
          return;
        }
      } catch {}

      // Fallback: use screen vs viewport difference heuristic
      const screenH = window.screen.height;
      const innerH = window.innerHeight;
      // Most Android status bars are 24-48dp
      const estimated = Math.min(Math.max(screenH - innerH - 48, 24), 48);
      document.documentElement.style.setProperty(
        "--cap-status-bar-height",
        `${estimated}px`
      );
    };

    setTimeout(setStatusBarHeight, 300);

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

    // Style the status bar
    import("@capacitor/status-bar")
      .then(({ StatusBar }) => {
        StatusBar.setBackgroundColor({ color: "#0c0818" }).catch(() => {});
      })
      .catch(() => {});

    // Start continuous session sync to native storage
    startSessionSync();

    // Setup deep link listener
    setupDeepLinkListener();

    // Setup network monitoring
    setupNetworkMonitor(setIsOffline);
  }, []);

  // Show offline screen if no network in Capacitor
  if (isCapacitor && isOffline) {
    return (
      <div className="fixed inset-0 z-[99999]">
        <OfflineScreen
          onRetry={() => {
            window.location.reload();
          }}
        />
      </div>
    );
  }

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
      console.log("[DeepLink] URL:", event.url);

      let path: string | null = null;

      try {
        const url = new URL(event.url);
        if (
          url.hostname === "peja.vercel.app" ||
          url.hostname === "www.peja.vercel.app"
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
        console.log("[DeepLink] Navigating to:", path);
        window.location.assign(path);
      }
    });
  } catch (err) {
    console.warn("[DeepLink] @capacitor/app not available:", err);
  }
}

// =====================================================
// NETWORK MONITOR
// =====================================================
async function setupNetworkMonitor(setIsOffline: (offline: boolean) => void) {
  try {
    const { Network } = await import("@capacitor/network");

    // Check initial status
    const status = await Network.getStatus();
    if (!status.connected) {
      setIsOffline(true);
    }

    // Listen for changes
    Network.addListener("networkStatusChange", (status) => {
      console.log("[Network] Status changed:", status.connected, status.connectionType);
      setIsOffline(!status.connected);
    });
  } catch {
    // Fallback to browser APIs
    setIsOffline(!navigator.onLine);

    window.addEventListener("online", () => setIsOffline(false));
    window.addEventListener("offline", () => setIsOffline(true));
  }
}