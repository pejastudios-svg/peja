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
          // Priority 1: SOS loading/options/active modal
          if ((window as any).__pejaSosModalOpen) {
            window.dispatchEvent(new Event("peja-close-sos-modal"));
            return;
          }

          // Priority 2: SOS detail modal (on map)
          if ((window as any).__pejaSosDetailOpen) {
            window.dispatchEvent(new Event("peja-close-sos-detail"));
            return;
          }

          // Priority 3: Analytics panel (and its inner detail view)
          if ((window as any).__pejaAnalyticsOpen) {
            window.dispatchEvent(new Event("peja-close-analytics"));
            return;
          }

          // Priority 4: Post modal (intercepted route)
          if ((window as any).__pejaPostModalOpen) {
            window.dispatchEvent(new Event("peja-close-post"));
            return;
          }

          // Priority 5: Overlay (edit profile, create, become-guardian)
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