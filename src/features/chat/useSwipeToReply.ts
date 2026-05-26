"use client";

// useSwipeToReply
// ---------------
// Drag a message sideways to set the reply target. Returns
// { handlers, dragX, progress } so the bubble can translate + render
// a fading reply-icon hint.
//
// Behaviour notes:
//   • Direction lock: we only commit to the swipe gesture after the
//     pointer has moved more horizontally than vertically. Vertical
//     scroll wins until the horizontal motion is unambiguous, so the
//     thread keeps scrolling smoothly without each bubble nudging
//     sideways on every touchmove.
//   • Damping: the bubble follows the finger at 50% speed so the
//     reply icon behind it has room to fade in before the bubble
//     fully clears the threshold. Same feel as Telegram / WhatsApp.
//   • Progress saturates at 1 right at the commit point and clamps
//     there even if the user keeps dragging. The caller uses this
//     to flip the reply icon into its "armed" state.
//   • Releasing past the threshold fires onCommit() and the bubble
//     snaps back via the consumer's `transition` on dragX === 0.

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Direction = "left" | "right";

type SwipeHandlers = {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
};

type UseSwipeToReplyResult = {
  handlers: SwipeHandlers;
  /** Current horizontal offset to apply to the bubble (already dampened). */
  dragX: number;
  /** 0..1 — how close the gesture is to firing. Pass to the reply-icon hint. */
  progress: number;
};

// How far the finger has to travel before we commit. The bubble actually
// translates by ~half of this because of damping below, so visually the
// threshold lands around 28px of bubble movement.
const COMMIT_THRESHOLD = 56;
// Damping factor — the bubble follows at half the finger's pace.
const DAMPING = 0.5;
// How much horizontal motion we need before locking into the swipe
// gesture. Below this we still allow the parent scroller to claim the
// gesture for a vertical pan.
const HORIZONTAL_ACTIVATION = 5;
// How much vertical motion before we bail entirely — the user is
// scrolling, not swiping. Tight thresholds (the previous 8px) ate
// real swipes on Android, where a deliberate sideways drag picks up
// 10-14 px of vertical drift before the user's finger settles into a
// horizontal line. We now require BOTH "vertical > 16" AND
// "vertical dominates horizontal" before bailing, so a swipe that
// drifted but is still mostly horizontal keeps going.
const VERTICAL_CANCEL = 16;

export function useSwipeToReply({
  direction,
  onCommit,
}: {
  direction: Direction;
  onCommit: () => void;
}): UseSwipeToReplyResult {
  const [dragX, setDragX] = useState(0);
  const [progress, setProgress] = useState(0);

  // Everything we need to remember about the in-flight gesture. Kept
  // in a ref so updates don't trigger a re-render — only setDragX /
  // setProgress do.
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    lastAllowedDx: number;
    captureTarget: Element | null;
  } | null>(null);

  const reset = useCallback(() => {
    setDragX(0);
    setProgress(0);
    gestureRef.current = null;
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    gestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      lastAllowedDx: 0,
      captureTarget: e.currentTarget as Element,
    };
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;

      // First-move arbitration: decide whether this is a swipe or a
      // scroll. Once we've decided it's a swipe we capture the pointer
      // so the bubble keeps receiving events even if the finger drifts
      // off it.
      if (!g.active) {
        if (Math.abs(dy) > VERTICAL_CANCEL && Math.abs(dy) > Math.abs(dx)) {
          // Vertical pan wins — let the chat scroll, and bail.
          gestureRef.current = null;
          return;
        }
        if (Math.abs(dx) > HORIZONTAL_ACTIVATION) {
          g.active = true;
          try {
            g.captureTarget?.setPointerCapture(g.pointerId);
          } catch {
            /* noop */
          }
        } else {
          return;
        }
      }

      // Direction-aware allowed motion. We never let the bubble move
      // the "wrong" way — it would imply replying to your own message
      // by swiping toward your own side of the screen.
      let allowed = 0;
      if (direction === "right" && dx > 0) allowed = dx;
      if (direction === "left" && dx < 0) allowed = dx;

      if (allowed === 0) {
        setDragX(0);
        setProgress(0);
        g.lastAllowedDx = 0;
        return;
      }

      g.lastAllowedDx = allowed;
      setDragX(allowed * DAMPING);
      setProgress(Math.min(1, Math.abs(allowed) / COMMIT_THRESHOLD));
    },
    [direction],
  );

  const onPointerUp = useCallback(() => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.active && Math.abs(g.lastAllowedDx) >= COMMIT_THRESHOLD) {
      // Commit — fire onCommit BEFORE resetting so the parent can
      // capture the current scroll position / focus before the
      // spring-back starts.
      onCommit();
    }
    reset();
  }, [onCommit, reset]);

  const onPointerCancel = useCallback(() => {
    reset();
  }, [reset]);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    dragX,
    progress,
  };
}
