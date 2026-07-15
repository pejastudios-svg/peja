"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Drag-to-dismiss + tap-to-close for bottom sheets: attach `bind` to the
 * grab zone (handle + header). Pointer Events, so mouse, touch, and pen
 * all behave identically - testable on desktop, native-feeling on phone.
 * Follows the pointer 1:1 downward; release either dismisses (far/fast
 * enough) or springs back. A clean tap/click (no meaningful movement)
 * also dismisses - real sheets close from the top.
 */
export function useSheetDrag(onDismiss: () => void) {
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ startY: number; startT: number } | null>(null);
  const moved = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { startY: e.clientY, startT: Date.now() };
    moved.current = false;
    // NOTE: capture happens on first real movement, not here - capturing
    // on pointerdown redirects the subsequent click to the grab zone,
    // stealing taps from child buttons (the + chip, the X, etc.).
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const delta = e.clientY - drag.current.startY;
    if (!moved.current && Math.abs(delta) > 8) {
      moved.current = true;
      // Now it's a drag: capture so it survives leaving the grab zone.
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    setDragY(Math.max(0, delta));
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const delta = e.clientY - drag.current.startY;
      const velocity = delta / Math.max(1, Date.now() - drag.current.startT);
      drag.current = null;
      setDragY(0);
      if (delta > 120 || velocity > 0.5) onDismiss();
    },
    [onDismiss]
  );

  const onPointerCancel = useCallback(() => {
    drag.current = null;
    setDragY(0);
  }, []);

  // Fires after pointerup for stationary taps; a real drag suppresses it.
  const onClick = useCallback(() => {
    if (moved.current) {
      moved.current = false;
      return;
    }
    onDismiss();
  }, [onDismiss]);

  return {
    dragY,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel,
      onClick,
    },
    style: {
      transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
      transition: dragY > 0 ? "none" : "transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
    } as React.CSSProperties,
  };
}
