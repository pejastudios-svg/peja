"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ShellAnimation = "fade" | "slide-up" | "scale";

export default function FullScreenModalShell({
  children,
  closeOnBackdrop = true,
  zIndex = 9999,
  scrollable = true,
  closeEventName,
  emitOverlayEvents = true,
  emitModalEvents = false,
  animation = "fade", // Default to your existing fade behavior
}: {
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
  zIndex?: number;
  scrollable?: boolean;
  closeEventName?: string;
  emitOverlayEvents?: boolean;
  emitModalEvents?: boolean;
  animation?: ShellAnimation;
}) {
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const closingRef = useRef(false);
  const aliveRef = useRef(false);
  const mountUrlRef = useRef<string>("");

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;

    // Trigger exit animation
    setMounted(false);

    // Wait for animation then back()
    // 300ms matches the duration-300 class
    window.setTimeout(() => {
      router.back();
    }, 300);
  };

  useEffect(() => {
    // Trigger entry animation next frame
    const t = requestAnimationFrame(() => setMounted(true));

    aliveRef.current = true;
    mountUrlRef.current = window.location.pathname + window.location.search;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onPopState = () => {
      const nextUrl = window.location.pathname + window.location.search;
      window.setTimeout(() => {
        if (!aliveRef.current) return;
        if (closingRef.current) return;
        if (nextUrl === mountUrlRef.current) return;

        const anyLayerOpen =
          (window as any).__pejaOverlayOpen === true ||
          (window as any).__pejaModalOpen === true ||
          (window as any).__pejaPostModalOpen === true;

        if (anyLayerOpen) {
          router.refresh();
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

    if (emitOverlayEvents) (window as any).__pejaOverlayOpen = true;
    if (emitModalEvents) (window as any).__pejaModalOpen = true;

    if (emitOverlayEvents) window.dispatchEvent(new Event("peja-overlay-open"));
    if (emitModalEvents) window.dispatchEvent(new Event("peja-modal-open"));

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

  // --- Animation Logic ---
  const getAnimationClasses = () => {
    switch (animation) {
      case "slide-up":
        return mounted ? "translate-y-0 opacity-100" : "translate-y-full opacity-0";
      case "scale":
        return mounted ? "scale-100 opacity-100" : "scale-95 opacity-0";
      case "fade":
      default:
        return mounted ? "opacity-100" : "opacity-0";
    }
  };

  // If sliding up, we want a backdrop (transparent) so we can see the app behind it.
  // If fading (standard navigation), we keep your solid mask to prevent peeking.
  const maskClass = animation === "slide-up" 
    ? "bg-black/60 backdrop-blur-sm transition-opacity duration-300"
    : "bg-dark-950"; 

  const maskStyle = animation === "slide-up" 
    ? { opacity: mounted ? 1 : 0 } 
    : {};

  return (
    <div className="fixed inset-0" style={{ zIndex }}>
      {/* Mask / Backdrop */}
      <div
        className={`absolute inset-0 ${maskClass}`}
        style={maskStyle}
        onClick={() => closeOnBackdrop && close()}
      />

      {/* Content Container */}
      <div
        className={[
          "absolute inset-0 bg-dark-950",
          scrollable ? "overflow-y-auto overscroll-contain" : "overflow-hidden",
          "transition-all duration-300 cubic-bezier(0.32, 0.72, 0, 1)", // Native iOS-like easing
          getAnimationClasses(),
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