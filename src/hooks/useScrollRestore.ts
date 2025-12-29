"use client";

import { useEffect } from "react";
import { useFeedCache } from "@/context/FeedContext";

export function useScrollRestore(key: string) {
  const feedCache = useFeedCache();

  useEffect(() => {
    const cached = feedCache.get(key);
    if (cached?.scrollY) requestAnimationFrame(() => window.scrollTo(0, cached.scrollY));
  }, [key, feedCache]);

  useEffect(() => {
    const save = () => feedCache.setScroll(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [key, feedCache]);
}