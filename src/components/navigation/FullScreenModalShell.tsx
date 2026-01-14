"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function FullScreenModalShell({
  children,
  closeOnBackdrop = true,
  zIndex = 9999,
  scrollable = true,
  closeEventName,

  // NEW: control which “pause” events are emitted
  emitOverlayEvents = true,
  emitModalEvents = false,
}: {
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
  zIndex?: number;
  scrollable?: boolean;

  // Optional: allow child to close via window event (for /watch close button)
  closeEventName?: string;

  // NEW
  emitOverlayEvents?: boolean;
  emitModalEvents?: boolean;
}) {
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const closingRef = useRef(false);

  const aliveRef = useRef(false);
  const mountUrlRef = useRef<string>("");

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;

    // Fade out content
    setMounted(false);

    // After fade, go back
    window.setTimeout(() => {
      router.back();
    }, 180);
  };

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));

    aliveRef.current = true;
    mountUrlRef.current = window.location.pathname + window.location.search;

    // Lock body scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

        const onPopState = () => {
      // If we pressed back/forward and the URL changed, the overlay should unmount.
      // If it doesn't (rare app-router mismatch after refresh), force a resync.
      const nextUrl = window.location.pathname + window.location.search;

      window.setTimeout(() => {
        if (!aliveRef.current) return;

        // If we're in the middle of our own close(), ignore.
        if (closingRef.current) return;

        // If URL didn't change, nothing to do.
        if (nextUrl === mountUrlRef.current) return;

        // If overlay still exists after navigation, router state is stuck.
                const anyLayerOpen =
          (window as any).__pejaOverlayOpen === true ||
          (window as any).__pejaModalOpen === true ||
          (window as any).__pejaPostModalOpen === true;

        if (anyLayerOpen) {
          router.refresh();

          // Last resort: if still stuck, hard reload to match the URL.
          window.setTimeout(() => {
            if (!aliveRef.current) return;
            if ((window as any).__pejaOverlayOpen === true) {
              window.location.reload();
            }
          }, 350);
        }
      }, 180);
    };

    window.addEventListener("popstate", onPopState);

        // Track what kind of layer is open
    if (emitOverlayEvents) (window as any).__pejaOverlayOpen = true;
    if (emitModalEvents) (window as any).__pejaModalOpen = true;

    // ✅ Emit pause events so videos under overlays stop immediately
    if (emitOverlayEvents) window.dispatchEvent(new Event("peja-overlay-open"));
    if (emitModalEvents) window.dispatchEvent(new Event("peja-modal-open"));

    // Optional external close event
    const onCloseEvent = () => close();
    if (closeEventName) {
      window.addEventListener(closeEventName, onCloseEvent);
    }

    return () => {
      aliveRef.current = false;
      window.removeEventListener("popstate", onPopState);

      cancelAnimationFrame(t);
      document.body.style.overflow = prev;

      if (emitOverlayEvents) (window as any).__pejaOverlayOpen = false;
      if (emitModalEvents) (window as any).__pejaModalOpen = false;

      if (emitOverlayEvents) window.dispatchEvent(new Event("peja-overlay-close"));
      if (emitModalEvents) window.dispatchEvent(new Event("peja-modal-close"));

      if (closeEventName) {
        window.removeEventListener(closeEventName, onCloseEvent);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0" style={{ zIndex }}>
      {/* 
        ✅ IMPORTANT:
        This is a SOLID full-screen mask (no opacity transition).
        It prevents Home (or any background) from ever peeking through during transitions.
      */}
      <div
        className="absolute inset-0 bg-dark-950"
        onClick={() => closeOnBackdrop && close()}
      />

      {/*
        ✅ IMPORTANT:
        No "top: 24px" gap animation.
        The sheet always covers the full screen.
        We only fade content in/out (opacity), so nothing underneath flashes.
      */}
      <div
        className={[
          "absolute inset-0 bg-dark-950",
          scrollable ? "overflow-y-auto overscroll-contain" : "overflow-hidden",
          "transition-opacity duration-200",
          mounted ? "opacity-100" : "opacity-0",
        ].join(" ")}
        style={{
          paddingTop: "env(safe-area-inset-top)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}