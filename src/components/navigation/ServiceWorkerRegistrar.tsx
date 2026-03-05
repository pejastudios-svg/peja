"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Register after the page loads to not block initial render
    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        // Check for updates every 30 minutes
        setInterval(() => {
          reg.update().catch(() => {});
        }, 30 * 60 * 1000);
      } catch {}
    };

    // Delay registration so it doesn't compete with initial page load
    if (document.readyState === "complete") {
      setTimeout(register, 2000);
    } else {
      window.addEventListener("load", () => setTimeout(register, 2000));
    }
  }, []);

  return null;
}