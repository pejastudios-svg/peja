"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function IOSSwipeBack() {
  const router = useRouter();
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const navigatingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Only activate on iOS Capacitor
    const ua = navigator.userAgent;
    const isIOS =
      /iPhone|iPad|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isCapacitor = (window as any).Capacitor !== undefined;

    if (!isIOS || !isCapacitor) return;

    const EDGE_WIDTH = 30; // pixels from left edge to trigger
    const MIN_DISTANCE = 80; // minimum swipe distance
    const MAX_Y_DRIFT = 100; // max vertical movement allowed
    const MAX_TIME = 500; // max time for the gesture (ms)

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;

      // Only trigger from the left edge
      if (touch.clientX > EDGE_WIDTH) return;

      // Don't trigger if a modal is open
      if (
        (window as any).__pejaSosModalOpen ||
        (window as any).__pejaSosDetailOpen ||
        (window as any).__pejaPostModalOpen ||
        (window as any).__pejaAnalyticsOpen
      ) {
        return;
      }

      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current || navigatingRef.current) return;

      const touch = e.changedTouches[0];
      if (!touch) {
        touchStartRef.current = null;
        return;
      }

      const dx = touch.clientX - touchStartRef.current.x;
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);
      const dt = Date.now() - touchStartRef.current.time;

      touchStartRef.current = null;

      // Validate: right swipe, mostly horizontal, fast enough
      if (dx >= MIN_DISTANCE && dy < MAX_Y_DRIFT && dt < MAX_TIME) {
        // Check we're not on the home page
        if (window.location.pathname === "/" || window.location.pathname === "") {
          return;
        }

        navigatingRef.current = true;

        // Close any open overlays first
        if ((window as any).__pejaOverlayOpen) {
          router.back();
        } else {
          router.back();
        }

        // Reset after navigation settles
        setTimeout(() => {
          navigatingRef.current = false;
        }, 500);
      }
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [router]);

  return null;
}