"use client";

import { useEffect } from "react";

/**
 * Freezes body scroll when `active` is true.
 * Handles nested modals via a ref count so scroll
 * only unlocks when ALL modals close.
 */
let lockCount = 0;
let savedScrollY = 0;

export function useScrollFreeze(active: boolean) {
  useEffect(() => {
    if (!active) return;

    lockCount++;

    if (lockCount === 1) {
      // Save scroll position and freeze
      savedScrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.overflow = "hidden";
    }

    return () => {
      lockCount--;

      if (lockCount === 0) {
        // Restore scroll
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.left = "";
        document.body.style.right = "";
        document.body.style.overflow = "";
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [active]);
}