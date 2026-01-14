"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function FullScreenModalShell({
  children,
  closeOnBackdrop = true,
  zIndex = 9999,
  scrollable = true,
  closeEventName,
}: {
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
  zIndex?: number;
  scrollable?: boolean;

  // Optional: allow child to close via window event (for /watch close button)
  closeEventName?: string;
}) {
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const closingRef = useRef(false);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;

    // animate out
    setMounted(false);

    // after animation, go back
    window.setTimeout(() => {
      router.back();
    }, 180);
  };

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));

    // lock body scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    (window as any).__pejaOverlayOpen = true;

    // ✅ pause videos underneath overlays/watch
    window.dispatchEvent(new Event("peja-overlay-open"));

    // Optional: listen for external close request
    const onCloseEvent = () => close();
    if (closeEventName) {
      window.addEventListener(closeEventName, onCloseEvent);
    }

    return () => {
      cancelAnimationFrame(t);
      document.body.style.overflow = prev;
      (window as any).__pejaOverlayOpen = false;

      window.dispatchEvent(new Event("peja-overlay-close"));

      if (closeEventName) {
        window.removeEventListener(closeEventName, onCloseEvent);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0" style={{ zIndex }}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          mounted ? "opacity-100" : "opacity-0"
        }`}
        onClick={() => closeOnBackdrop && close()}
      />

      {/* Sheet (NO transform => fixed headers/footers behave) */}
      <div
        className={`absolute left-0 right-0 bottom-0 bg-dark-950 transition-[top,opacity] duration-200 ${
          scrollable ? "overflow-y-auto overscroll-contain" : "overflow-hidden"
        } ${mounted ? "opacity-100" : "opacity-0"}`}
        style={{
          top: mounted ? "0px" : "24px",
          paddingTop: "env(safe-area-inset-top)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}