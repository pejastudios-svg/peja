"use client";

import { useState, useEffect } from "react";
import { WifiOff, Wifi } from "lucide-react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const goOffline = () => {
      setOffline(true);
      setWasOffline(true);
    };

    const goOnline = () => {
      setOffline(false);
      if (wasOffline) {
        setShowRestored(true);
        setTimeout(() => setShowRestored(false), 3000);
      }
    };

    // Check initial state
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

  if (!offline && !showRestored) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999998] flex justify-center"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + var(--cap-status-bar-height, 4px))",
      }}
    >
      <div
        className="mx-4 mt-1 flex items-center gap-2 px-4 py-2 rounded-full max-w-sm w-auto"
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
            <span className="text-xs font-medium text-red-300">No internet — using cached data</span>
          </>
        ) : (
          <>
            <Wifi className="w-3.5 h-3.5 text-green-400 shrink-0" />
            <span className="text-xs font-medium text-green-300">Back online</span>
          </>
        )}
      </div>
    </div>
  );
}