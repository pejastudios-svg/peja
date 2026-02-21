"use client";

import { useRef } from "react";

export function useLongPress(onLongPress: () => void, ms = 350) {
  const timer = useRef<number | null>(null);

  const start = () => {
    timer.current = window.setTimeout(() => onLongPress(), ms);
  };

  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onContextMenu: (e: any) => e.preventDefault(),
  };
}