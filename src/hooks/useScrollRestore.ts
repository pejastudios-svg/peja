"use client";

import { useEffect } from "react";
import { useFeedCache } from "@/context/FeedContext";

export function useScrollRestore(key: string, enabled: boolean = true) {
  const feedCache = useFeedCache();

  // Restore scroll when enabled becomes true
  useEffect(() => {
    if (!enabled) return;

    const cached = feedCache.get(key);
    const targetY = cached?.scrollY || 0;
    if (!targetY) return;

    let tries = 0;

    const attempt = () => {
      tries++;

      // Try to restore
      window.scrollTo(0, targetY);

      // If it didn't stick yet, retry a few times (content may still be rendering)
      if (tries < 12 && Math.abs(window.scrollY - targetY) > 2) {
        requestAnimationFrame(attempt);
      }
    };

    requestAnimationFrame(attempt);
  }, [key, feedCache, enabled]);

  // Save scroll
  useEffect(() => {
    if (!enabled) return;

    const save = () => feedCache.setScroll(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [key, feedCache, enabled]);
}