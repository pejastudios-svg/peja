"use client";

// Touch gesture: swipe a message bubble horizontally (toward the
// center of the screen) past a threshold to trigger "reply". Same
// pattern as WhatsApp / Telegram.
//
//   • mine bubble (sender, right-aligned)   → swipe LEFT to reply
//   • theirs bubble (receiver, left-aligned) → swipe RIGHT to reply
//
// Returns the props to spread on the bubble + a `dragX` value (0 when
// idle, negative for mine, positive for theirs) so the caller can
// translate the bubble and fade a reply icon in.
//
// Implementation rules:
//   • Only horizontal pointer movement counts as a swipe. Once we
//     detect a vertical drag dominates, we bail so the user can keep
//     scrolling the thread.
//   • We DO NOT listen on mouse — desktop has its own action menu via
//     the chevron. This gesture is touch-only.
//   • If the swipe commits past the threshold, fire `onCommit` once
//     and snap dragX back to 0.

import { useCallback, useRef, useState } from "react";

interface Options {
  // Which direction this bubble allows the swipe to commit in.
  // Determined by isMine — see comments above.
  direction: "left" | "right";
  threshold?: number;
  onCommit: () => void;
}

const DEFAULT_THRESHOLD = 60;
const VERTICAL_SLOP = 12;
const MAX_DRAG = 90;

export function useSwipeToReply({
  direction,
  threshold = DEFAULT_THRESHOLD,
  onCommit,
}: Options) {
  const [dragX, setDragX] = useState(0);
  const startRef = useRef<{
    x: number;
    y: number;
    locked: "horizontal" | "vertical" | null;
    committed: boolean;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    startRef.current = {
      x: e.clientX,
      y: e.clientY,
      locked: null,
      committed: false,
    };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;

      // Decide axis on first meaningful movement. Once locked we
      // stick with that axis for the rest of the gesture so a stray
      // vertical wobble doesn't kill the swipe halfway through.
      if (start.locked === null) {
        if (Math.abs(dx) > VERTICAL_SLOP && Math.abs(dx) > Math.abs(dy)) {
          start.locked = "horizontal";
        } else if (Math.abs(dy) > VERTICAL_SLOP) {
          start.locked = "vertical";
        }
      }
      if (start.locked !== "horizontal") return;

      // Only register movement in the allowed direction. Pulling in
      // the wrong direction does nothing.
      const allowed =
        direction === "left" ? Math.min(0, dx) : Math.max(0, dx);
      const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, allowed));
      setDragX(clamped);

      if (
        !start.committed &&
        Math.abs(clamped) >= threshold
      ) {
        start.committed = true;
        onCommit();
        // Snap back so the bubble doesn't keep dragging after commit.
        setDragX(0);
        startRef.current = null;
      }
    },
    [direction, threshold, onCommit]
  );

  const onPointerUp = useCallback(() => {
    startRef.current = null;
    setDragX(0);
  }, []);

  const onPointerCancel = useCallback(() => {
    startRef.current = null;
    setDragX(0);
  }, []);

  // 0..1 — how close the user is to the commit threshold. Consumers
  // use this to fade in a reply icon next to the bubble so the
  // gesture becomes visible / discoverable. Saturates at 1 right
  // before the commit fires.
  const progress = Math.min(1, Math.abs(dragX) / threshold);

  return {
    dragX,
    progress,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
