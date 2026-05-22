"use client";

// Long-press detection for opening the message action menu on touch
// devices. Fires `onLongPress(x, y)` after `delay` ms of holding
// without a meaningful pointer move (≤ MOVE_TOLERANCE px).
//
// Returns the props you spread onto the element you want to long-press.
//
// Implementation notes:
//   • Pointer events (not touch events) so the same handler works on
//     mouse + touch + stylus. Mouse long-press is treated as a
//     legitimate trigger too — power users on desktop can hold to
//     open the menu instead of clicking the chevron.
//   • We cancel on `pointerleave`, not just `pointerup`, so dragging
//     the finger off a bubble dismisses the timer cleanly.
//   • Suppresses the OS-native long-press selection by calling
//     `preventDefault()` once the long-press resolves — without this
//     a successful long-press on text content can fire BOTH our menu
//     and the WebView's "select text" handle.

import { useCallback, useRef } from "react";

interface Options {
  delay?: number;
  moveTolerance?: number;
  onLongPress: (x: number, y: number) => void;
}

const DEFAULT_DELAY = 500;
const DEFAULT_MOVE_TOLERANCE = 8;

export function useLongPress({
  delay = DEFAULT_DELAY,
  moveTolerance = DEFAULT_MOVE_TOLERANCE,
  onLongPress,
}: Options) {
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Right-click has its own onContextMenu handler — don't double-fire.
      if (e.button === 2) return;
      firedRef.current = false;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      const target = e.currentTarget;
      timerRef.current = window.setTimeout(() => {
        if (!startPosRef.current) return;
        firedRef.current = true;
        onLongPress(startPosRef.current.x, startPosRef.current.y);
        // Best-effort: release pointer capture so the subsequent
        // pointerup doesn't fire a click on whatever's under the
        // pointer once the menu opens on top.
        try {
          (target as HTMLElement).releasePointerCapture?.(e.pointerId);
        } catch {}
      }, delay);
    },
    [delay, onLongPress]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = startPosRef.current;
      if (!start) return;
      const dx = Math.abs(e.clientX - start.x);
      const dy = Math.abs(e.clientY - start.y);
      if (dx > moveTolerance || dy > moveTolerance) cancel();
    },
    [moveTolerance, cancel]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      // If the timer already fired the long-press, swallow the
      // accompanying click so the bubble doesn't also open a lightbox.
      if (firedRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
      cancel();
    },
    [cancel]
  );

  const onPointerLeave = useCallback(() => {
    cancel();
  }, [cancel]);

  const onPointerCancel = useCallback(() => {
    cancel();
  }, [cancel]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
  };
}
