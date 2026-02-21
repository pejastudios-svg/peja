"use client";

import { useEffect } from "react";
import { ensureNotificationAudioUnlocked } from "@/lib/notificationSound";

export default function UserGestureAudioUnlocker() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const unlock = () => {
      ensureNotificationAudioUnlocked();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };

    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("touchstart", unlock, { passive: true });
    window.addEventListener("keydown", unlock);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  return null;
}