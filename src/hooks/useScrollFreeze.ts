"use client";

import { useEffect } from "react";

let lockCount = 0;
let savedScrollY = 0;

export function useScrollFreeze(active: boolean) {
  useEffect(() => {
    if (!active) return;

    lockCount++;

    if (lockCount === 1) {
      savedScrollY = window.scrollY;
      // Use overflow hidden instead of position fixed to avoid iOS safe area shifts
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    }

    return () => {
      lockCount--;

      if (lockCount === 0) {
        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";
        document.body.style.touchAction = "";
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [active]);
} 