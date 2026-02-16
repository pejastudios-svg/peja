"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const positions = new Map<string, number>();

export function ScrollRestorer() {
  const pathname = usePathname();
  const lastPathRef = useRef(pathname);

  useEffect(() => {
    if (lastPathRef.current !== pathname) {
      positions.set(lastPathRef.current, window.scrollY);
      lastPathRef.current = pathname;
    }

    const saved = positions.get(pathname);
    if (saved && saved > 0) {
      const timers = [
        setTimeout(() => window.scrollTo(0, saved), 0),
        setTimeout(() => window.scrollTo(0, saved), 50),
        setTimeout(() => window.scrollTo(0, saved), 150),
        setTimeout(() => window.scrollTo(0, saved), 300),
      ];
      return () => timers.forEach(clearTimeout);
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  useEffect(() => {
    const save = () => positions.set(pathname, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [pathname]);

  return null;
}