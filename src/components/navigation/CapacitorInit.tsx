"use client";

import { useEffect } from "react";

export function CapacitorInit() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Capacitor Android WebView always includes "wv" (WebView) in the user agent
    // and we can also check for Android specifically
    const ua = navigator.userAgent || "";
    const isAndroidWebView = /Android/.test(ua) && /wv/.test(ua);
    const isCapacitorBridge = (window as any).Capacitor !== undefined;

    if (!isAndroidWebView && !isCapacitorBridge) return;

    // Mark the document
    document.documentElement.classList.add("capacitor-native");

    // Get the actual status bar height by measuring the difference
    // between window.screen.height and window.innerHeight isn't reliable,
    // so we use a known safe value for Android status bars
    document.documentElement.style.setProperty(
      "--cap-status-bar-height",
      "48px"
    );

    // Try to style the status bar if plugin is available
    import("@capacitor/status-bar")
      .then(({ StatusBar }) => {
        StatusBar.setBackgroundColor({ color: "#0c0818" }).catch(() => {});
      })
      .catch(() => {});
  }, []);

  return null;
}