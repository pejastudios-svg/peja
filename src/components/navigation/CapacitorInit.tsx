"use client";
import { useEffect } from "react";
import { syncSessionToNative, isCapacitorNative } from "@/lib/supabase";
export function CapacitorInit() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isCapacitorNative()) return;
    // Mark the document for CSS rules
    document.documentElement.classList.add("capacitor-native");
    // Set status bar height CSS variable
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
    // ---------------------------------------------------------
    // Continuous session sync to native storage
    // ---------------------------------------------------------
    const syncInterval = setInterval(syncSessionToNative, 3000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        syncSessionToNative();
      }
    };
    const handlePageHide = () => {
      syncSessionToNative();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
    // ---------------------------------------------------------
    // Deep link handling (Problem 2)
    // ---------------------------------------------------------
    setupDeepLinkListener();
    return () => {
      clearInterval(syncInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
    };
  }, []);
  return null;
}
/**
 * Listen for deep links / app links via @capacitor/app.
 * When the OS opens the app with a URL like https://peja.vercel.app/post/abc123,
 * we extract the path and use Next.js router to navigate to it.
 */
async function setupDeepLinkListener() {
  try {
    const { App } = await import("@capacitor/app");
    // Handle URL when app is already running (brought to foreground via link)
    App.addListener("appUrlOpen", (event) => {
      console.log("[DeepLink] App opened with URL:", event.url);
      try {
        const url = new URL(event.url);
        const path = url.pathname + url.search + url.hash;
        if (path && path !== "/") {
          console.log("[DeepLink] Navigating to:", path);
          // Use window.location for reliable navigation in Capacitor WebView
          window.location.href = path;
        }
      } catch (err) {
        console.warn("[DeepLink] Failed to parse URL:", err);
      }
    });
    // Check if the app was cold-started with a URL
    const launchUrl = await App.getLaunchUrl();
    if (launchUrl?.url) {
      console.log("[DeepLink] App launched with URL:", launchUrl.url);
      try {
        const url = new URL(launchUrl.url);
        const path = url.pathname + url.search + url.hash;
        if (path && path !== "/") {
          // Small delay to let the app initialize
          setTimeout(() => {
            window.location.href = path;
          }, 500);
        }
      } catch (err) {
        console.warn("[DeepLink] Failed to parse launch URL:", err);
      }
    }
  } catch (err) {
    console.warn("[DeepLink] @capacitor/app not available:", err);
  }
}