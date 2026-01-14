"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const KEY = "peja-route-scroll-v1";

function read(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function write(store: Record<string, number>) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(store));
  } catch {}
}

export default function RouteScrollKeeper() {
  const pathname = usePathname();
  const sp = useSearchParams();

  const routeKey = useMemo(() => {
    // include query string so /search?q=... preserves its own scroll
    const qs = sp?.toString() || "";
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, sp]);

  useEffect(() => {
    // restore (retry to survive async rendering)
    const store = read();
    const target = store[routeKey] ?? 0;

    let tries = 0;
    const restore = () => {
      tries++;
      window.scrollTo(0, target);
      if (tries < 20 && Math.abs(window.scrollY - target) > 2) {
        requestAnimationFrame(restore);
      }
    };

    requestAnimationFrame(restore);

    // save
    const onScroll = () => {
      const s = read();
      s[routeKey] = window.scrollY;
      write(s);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      onScroll();
      window.removeEventListener("scroll", onScroll);
    };
  }, [routeKey]);

  return null;
}