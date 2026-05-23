"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    const isProd = process.env.NODE_ENV === "production";

    // Never keep SW active on localhost/dev: stale app-shell cache can trap
    // navigation transitions (e.g. /create -> /login) behind a black frame.
    if (!isProd || isLocalhost) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister().catch(() => {}));
      });
      if ("caches" in window) {
        caches.keys().then((keys) => {
          keys
            .filter((k) => k.startsWith("peja-") || k.includes("peja"))
            .forEach((k) => caches.delete(k).catch(() => {}));
        });
      }
      return;
    }

    // Reload once when a new SW takes over so the page picks up fresh code
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });

    // Register after page load to not block rendering
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        // Check for updates periodically (every 30 minutes)
        setInterval(() => {
          registration.update().catch(() => {});
        }, 30 * 60 * 1000);

        // Check for updates every time the app becomes visible (Capacitor foreground)
        const onVisibility = () => {
          if (document.visibilityState === "visible") {
            registration.update().catch(() => {});
          }
        };
        document.addEventListener("visibilitychange", onVisibility);

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
