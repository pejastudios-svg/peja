"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    const isProd = process.env.NODE_ENV === "production";

    // This component is legacy; real SW registration lives in
    // ServiceWorkerRegistration. In dev/localhost, proactively clean up old
    // workers/caches so stale route shells cannot cause black-screen navigations.
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

    // No-op in production: avoid duplicate SW registration.
  }, []);

  return null;
}