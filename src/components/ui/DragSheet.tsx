"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Portal } from "./Portal";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";

/**
 * Bottom sheet that behaves like the map sheet: it follows the finger
 * 1:1 while dragging down and either dismisses (far enough / fast
 * enough) or springs back. Used by the SOS and SML flows so every
 * bottom surface in the app shares one motion language.
 *
 * Content taller than the sheet scrolls internally; the drag-to-dismiss
 * gesture grabs from the handle area so it never fights inner scrolling.
 */
export function DragSheet({
  open,
  onClose,
  children,
  maxHeight = "85vh",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ startY: number; startT: number } | null>(null);
  useScrollFreeze(open);

  // Enter animation: mount hidden below, then slide up next frame.
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    setDragY(0);
  }, [open]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    drag.current = { startY: e.touches[0].clientY, startT: Date.now() };
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!drag.current) return;
    const delta = e.touches[0].clientY - drag.current.startY;
    setDragY(Math.max(0, delta)); // only downward
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!drag.current) return;
      const delta = e.changedTouches[0].clientY - drag.current.startY;
      const velocity = delta / Math.max(1, Date.now() - drag.current.startT);
      drag.current = null;
      if (delta > 120 || velocity > 0.5) {
        onClose();
      } else {
        setDragY(0); // spring back
      }
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[100000]">
        {/* backdrop */}
        <div
          className="absolute inset-0 bg-black/60 transition-opacity duration-300"
          style={{ opacity: visible ? 1 : 0 }}
          onClick={onClose}
        />
        {/* sheet */}
        <div
          className="absolute left-0 right-0 bottom-0 rounded-t-[24px] overflow-hidden flex flex-col"
          style={{
            maxHeight,
            background: "var(--glass-float-bg)",
            borderTop: "1px solid var(--glass-border)",
            boxShadow: "var(--glass-shadow-float)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            transform: visible ? `translateY(${dragY}px)` : "translateY(100%)",
            transition:
              drag.current || dragY > 0
                ? "none"
                : "transform 0.45s cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        >
          {/* drag handle zone (the grabbable strip) */}
          <div
            className="shrink-0 pt-2.5 pb-1.5 cursor-grab"
            style={{ touchAction: "none" }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <div className="mx-auto w-10 h-1 rounded-full sheet-handle" />
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </div>
      </div>
    </Portal>
  );
}
