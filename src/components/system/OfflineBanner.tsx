"use client";

import { useState, useEffect } from "react";
import { WifiOff, Wifi, X } from "lucide-react";

// Dismissal is scoped to BOTH the current state AND the session. When
// the user taps X on "No internet" we stop showing the offline pill
// until the next online/offline edge transition (so a subsequent drop
// can still surface). Same idea for "Back online" — once dismissed,
// the next reconnect after another drop can surface again.
//
// sessionStorage keys: persist for the page session so a hard reload
// inside the same offline window keeps the pill hidden.
const KEY_OFFLINE_DISMISSED = "peja:offline-banner-dismissed:offline";
const KEY_RESTORED_DISMISSED = "peja:offline-banner-dismissed:restored";

function readDismissed(key: string): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(key: string, val: boolean): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (val) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch {}
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const [showRestored, setShowRestored] = useState(false);
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const [restoredDismissed, setRestoredDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Hydrate dismissal flags from sessionStorage on mount.
    setOfflineDismissed(readDismissed(KEY_OFFLINE_DISMISSED));
    setRestoredDismissed(readDismissed(KEY_RESTORED_DISMISSED));

    const goOffline = () => {
      setOffline(true);
      setWasOffline(true);
      // New drop edge — un-dismiss so this drop can show.
      setOfflineDismissed(false);
      writeDismissed(KEY_OFFLINE_DISMISSED, false);
    };

    const goOnline = () => {
      setOffline(false);
      if (wasOffline) {
        setShowRestored(true);
        setRestoredDismissed(false);
        writeDismissed(KEY_RESTORED_DISMISSED, false);
        setTimeout(() => setShowRestored(false), 3000);
      }
    };

    if (!navigator.onLine) {
      setOffline(true);
      setWasOffline(true);
    }

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [wasOffline]);

  const showingOffline = offline && !offlineDismissed;
  const showingRestored = showRestored && !restoredDismissed;
  if (!showingOffline && !showingRestored) return null;

  const dismiss = () => {
    if (offline) {
      setOfflineDismissed(true);
      writeDismissed(KEY_OFFLINE_DISMISSED, true);
    } else {
      setRestoredDismissed(true);
      writeDismissed(KEY_RESTORED_DISMISSED, true);
    }
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999998] flex justify-center"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + var(--cap-status-bar-height, 4px))",
      }}
    >
      <div
        className="mx-4 mt-1 flex items-center gap-2 pl-4 pr-2 py-2 rounded-full max-w-sm w-auto"
        style={{
          background: offline
            ? "rgba(239, 68, 68, 0.15)"
            : "rgba(34, 197, 94, 0.15)",
          border: `1px solid ${offline ? "rgba(239, 68, 68, 0.3)" : "rgba(34, 197, 94, 0.3)"}`,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
          animation: "slideDown 0.3s ease-out",
        }}
      >
        {offline ? (
          <>
            <WifiOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="text-xs font-medium text-red-300">No internet</span>
          </>
        ) : (
          <>
            <Wifi className="w-3.5 h-3.5 text-green-400 shrink-0" />
            <span className="text-xs font-medium text-green-300">Back online</span>
          </>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="p-1 rounded-full hover:bg-white/10 active:bg-white/20 transition-colors shrink-0"
          aria-label="Dismiss"
          style={{
            color: offline ? "rgba(252, 165, 165, 0.85)" : "rgba(134, 239, 172, 0.85)",
          }}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
