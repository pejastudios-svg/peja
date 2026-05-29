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

        // On a new deploy, ask the active SW to re-warm its precache so the
        // new build's CSS/JS chunks are cached proactively. The SW only
        // reinstalls when sw.js's own bytes change, so a web-only deploy
        // (new asset hashes, same sw.js) would otherwise leave the new CSS
        // uncached — the cause of offline cold-opens rendering as raw,
        // unstyled HTML. No reload involved; the re-warm runs in the SW.
        try {
          const version =
            process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev";
          const PRECACHE_KEY = "sw-precache-version";
          if (version !== "dev" && localStorage.getItem(PRECACHE_KEY) !== version) {
            const ready = await navigator.serviceWorker.ready;
            const active = ready.active || registration.active;
            if (active) {
              active.postMessage({ type: "reprecache" });
              localStorage.setItem(PRECACHE_KEY, version);
            }
          }
        } catch {}

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
