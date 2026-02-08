"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function CapacitorBackButton() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isCapacitor =
      (window as any).Capacitor !== undefined ||
      navigator.userAgent.includes("CapacitorApp");

    if (!isCapacitor) return;

    let lastBackPress = 0;
    let cleanup: (() => void) | null = null;

    import("@capacitor/app")
      .then(({ App }) => {
        const listener = App.addListener("backButton", ({ canGoBack }) => {
          // If a modal is open, close it
          if ((window as any).__pejaPostModalOpen) {
            window.dispatchEvent(new Event("peja-close-post"));
            return;
          }

          if ((window as any).__pejaOverlayOpen) {
            router.back();
            return;
          }

          // If browser history exists, go back
          if (canGoBack) {
            router.back();
            return;
          }

          // Double-tap to exit
          const now = Date.now();
          if (now - lastBackPress < 2000) {
            App.exitApp();
          } else {
            lastBackPress = now;
          }
        });

        cleanup = () => {
          listener.then((l) => l.remove());
        };
      })
      .catch(() => {});

    return () => {
      if (cleanup) cleanup();
    };
  }, [router]);

  return null;
}