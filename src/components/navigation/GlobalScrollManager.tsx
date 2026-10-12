"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { releaseAllScrollFreezes } from "@/hooks/useScrollFreeze";

export default function GlobalScrollManager() {
  const pathname = usePathname();

  useEffect(() => {
    // ONLY disable browser restoration. Do NOT touch window.scrollTo here.
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  // Release any scroll lock on every route change.
  //
  // A modal that freezes scroll normally unfreezes it on unmount, but a
  // navigation can tear the holder down in ways React does not always
  // run cleanup for, and the result is a page nobody can scroll with
  // nothing on screen to dismiss. The only recovery was a refresh.
  //
  // Arriving somewhere new is an unambiguous signal that no dialog from
  // the previous screen should still be holding the page.
  useEffect(() => {
    releaseAllScrollFreezes();
  }, [pathname]);

  return null;
}
