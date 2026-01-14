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

    // Lock body scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    (window as any).__pejaOverlayOpen = true;

    // ✅ Emit pause events so videos under overlays stop immediately
    if (emitOverlayEvents) window.dispatchEvent(new Event("peja-overlay-open"));
    if (emitModalEvents) window.dispatchEvent(new Event("peja-modal-open"));

    // Optional external close event
    const onCloseEvent = () => close();
    if (closeEventName) {
      window.addEventListener(closeEventName, onCloseEvent);
    }

    return () => {
      cancelAnimationFrame(t);
      document.body.style.overflow = prev;

      (window as any).__pejaOverlayOpen = false;

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