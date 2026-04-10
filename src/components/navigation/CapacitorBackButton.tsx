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

    // ─── iOS swipe-back: close modals/overlays on popstate ───
    const handlePopState = () => {
      // When iOS swipe-back fires, close any open modals
      if ((window as any).__pejaSosModalOpen) {
        window.dispatchEvent(new Event("peja-close-sos-modal"));
        return;
      }
      if ((window as any).__pejaSosDetailOpen) {
        window.dispatchEvent(new Event("peja-close-sos-detail"));
        return;
      }
      if ((window as any).__pejaAnalyticsOpen) {
        window.dispatchEvent(new Event("peja-close-analytics"));
        return;
      }
      if ((window as any).__pejaPostModalOpen) {
        window.dispatchEvent(new Event("peja-close-post"));
        return;
      }
    };

    window.addEventListener("popstate", handlePopState);

    // ─── Android hardware back button ───
    import("@capacitor/app")
      .then(({ App }) => {
        const listener = App.addListener("backButton", ({ canGoBack }) => {
          if ((window as any).__pejaSosModalOpen) {
            window.dispatchEvent(new Event("peja-close-sos-modal"));
            return;
          }
          if ((window as any).__pejaSosDetailOpen) {
            window.dispatchEvent(new Event("peja-close-sos-detail"));
            return;
          }
          if ((window as any).__pejaAnalyticsOpen) {
            window.dispatchEvent(new Event("peja-close-analytics"));
            return;
          }
          if ((window as any).__pejaPostModalOpen) {
            window.dispatchEvent(new Event("peja-close-post"));
            return;
          }
          if ((window as any).__pejaOverlayOpen) {
            router.back();
            return;
          }
         if (canGoBack) {
            router.back();
            return;
          }
          // If not on home page and can't go back, go home
          if (window.location.pathname !== "/") {
            router.push("/");
            return;
          }
          // On home page with no history - double tap to exit
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
      window.removeEventListener("popstate", handlePopState);
      if (cleanup) cleanup();
    };
  }, [router]);

  return null;
}