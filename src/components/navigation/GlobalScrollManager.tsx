"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const STORE_KEY = "peja-scroll-positions-v1";

// pages with custom scrollers or special behavior
const EXCLUDE_PREFIXES = ["/watch"]; // watch uses its own internal scroller

function readStore(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, number>) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {}
}

export default function GlobalScrollManager() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const routeKey = useMemo(() => {
    const qs = searchParams?.toString() || "";
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  const isExcluded = EXCLUDE_PREFIXES.some((p) => routeKey.startsWith(p));

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isExcluded) return;

    // Restore (retry a few frames so it sticks even if content loads late)
    const store = readStore();
    const targetY = store[routeKey] ?? 0;

    let tries = 0;
    const attemptRestore = () => {
      tries++;
      window.scrollTo(0, targetY);

      // keep trying briefly until it sticks or we give up
      if (tries < 16 && Math.abs(window.scrollY - targetY) > 2) {
        requestAnimationFrame(attemptRestore);
      }
    };

    requestAnimationFrame(attemptRestore);

    // Save on scroll
    const onScroll = () => {
      const current = readStore();
      current[routeKey] = window.scrollY;
      writeStore(current);
    };

    window.addEventListener("scroll", onScroll, { passive: true });

    // Save once on cleanup too
    return () => {
      onScroll();
      window.removeEventListener("scroll", onScroll);
    };
  }, [routeKey, isExcluded]);

  return null;
}