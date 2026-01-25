"use client";
import { useEffect } from "react";

export default function GlobalScrollManager() {
  useEffect(() => {
    // ONLY disable browser restoration. Do NOT touch window.scrollTo here.
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  return null;
}