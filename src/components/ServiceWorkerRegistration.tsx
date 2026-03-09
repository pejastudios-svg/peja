"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Register after page load to not block rendering
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        // Check for updates periodically (every 30 minutes)
        setInterval(() => {
          registration.update();
        }, 30 * 60 * 1000);

        // Handle updates
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New version available, activate it silently
              newWorker.postMessage("skipWaiting");
            }
          });
        });
      } catch (err) {
        // SW registration failed, app still works without it
      }
    };

    // Delay registration so it doesn't compete with initial page load
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
