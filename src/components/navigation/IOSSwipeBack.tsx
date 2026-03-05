"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export function IOSSwipeBack() {
  const router = useRouter();
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchRef = useRef<{ startX: number; startY: number; started: boolean; locked: boolean } | null>(null);
  const navigatingRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const EDGE = 25;
  const THRESHOLD = 100;
  const MAX_Y = 80;

  const doGoBack = useCallback(() => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;

    // Close modals first if open
    if ((window as any).__pejaPostModalOpen) {
      window.dispatchEvent(new Event("peja-close-post"));
    } else if ((window as any).__pejaSosModalOpen) {
      window.dispatchEvent(new Event("peja-close-sos-modal"));
    } else if ((window as any).__pejaSosDetailOpen) {
      window.dispatchEvent(new Event("peja-close-sos-detail"));
    } else if ((window as any).__pejaAnalyticsOpen) {
      window.dispatchEvent(new Event("peja-close-analytics"));
    } else if ((window as any).__pejaOverlayOpen) {
      router.back();
    } else if (window.location.pathname !== "/" && window.location.pathname !== "") {
      router.back();
    }

    setTimeout(() => { navigatingRef.current = false; }, 600);
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isCapacitor = (window as any).Capacitor !== undefined;
    if (!isIOS || !isCapacitor) return;

    const onTouchStart = (e: TouchEvent) => {
      if (navigatingRef.current) return;
      const t = e.touches[0];
      if (!t || t.clientX > EDGE) return;

      // Don't start on home page
      if (window.location.pathname === "/" || window.location.pathname === "") return;

      touchRef.current = { startX: t.clientX, startY: t.clientY, started: false, locked: false };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchRef.current || navigatingRef.current) return;
      const t = e.touches[0];
      if (!t) return;

      const dx = t.clientX - touchRef.current.startX;
      const dy = Math.abs(t.clientY - touchRef.current.startY);

      // Lock direction on first significant move
      if (!touchRef.current.locked && (dx > 10 || dy > 10)) {
        touchRef.current.locked = true;
        if (dy > dx || dx < 0) {
          // Vertical scroll or left swipe — cancel
          touchRef.current = null;
          return;
        }
        touchRef.current.started = true;
        setIsDragging(true);
      }

      if (!touchRef.current?.started) return;
      if (dy > MAX_Y) {
        touchRef.current = null;
        setIsDragging(false);
        setDragX(0);
        return;
      }

      const clamped = Math.max(0, Math.min(dx, window.innerWidth));
      setDragX(clamped);
    };

    const onTouchEnd = () => {
      if (!touchRef.current?.started) {
        touchRef.current = null;
        return;
      }

      const finalX = dragX;
      touchRef.current = null;

      if (finalX >= THRESHOLD) {
        // Animate out then navigate
        setDragX(window.innerWidth);
        setTimeout(() => {
          doGoBack();
          setIsDragging(false);
          setDragX(0);
        }, 200);
      } else {
        // Snap back
        setDragX(0);
        setTimeout(() => setIsDragging(false), 200);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [dragX, doGoBack]);

  if (!isDragging && dragX === 0) return null;

  const progress = Math.min(dragX / THRESHOLD, 1);
  const opacity = 0.5 * (1 - progress * 0.8);

  return (
    <>
      {/* Dark overlay behind the sliding page */}
      <div
        ref={overlayRef}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999998,
          backgroundColor: `rgba(0,0,0,${opacity})`,
          pointerEvents: "none",
          transition: isDragging && touchRef.current?.started ? "none" : "background-color 200ms ease",
        }}
      />

      {/* Edge indicator arrow */}
      <div
        style={{
          position: "fixed",
          left: 0,
          top: "50%",
          transform: `translateY(-50%) translateX(${Math.min(dragX * 0.3, 30) - 30}px)`,
          zIndex: 999999,
          width: 30,
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: progress,
          transition: isDragging && touchRef.current?.started ? "none" : "all 200ms ease",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: `rgba(124, 58, 237, ${0.3 + progress * 0.5})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </div>
      </div>

      {/* Page slide effect — applied via CSS transform on body's first child */}
      <style>{`
        body > :first-child {
          transform: translateX(${dragX}px) !important;
          transition: ${isDragging ? "none" : "transform 200ms ease"} !important;
        }
      `}</style>
    </>
  );
}