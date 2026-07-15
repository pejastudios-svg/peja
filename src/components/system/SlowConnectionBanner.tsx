"use client";

import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff } from "lucide-react";

export function SlowConnectionBanner() {
  const [show, setShow] = useState(false);
  const [connectionType, setConnectionType] = useState<"slow" | "back" | null>(null);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasSlowRef = useRef(false);
  const dismissedRef = useRef(false);
  const lastCheckRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkConnection = () => {
      // Don't check more than once every 10 seconds
      const now = Date.now();
      if (now - lastCheckRef.current < 10000) return;
      lastCheckRef.current = now;

      // Use Network Information API if available
      const nav = navigator as any;
      const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

     let isSlow = false;

      if (conn) {
        const type = conn.effectiveType;
        const downlink = conn.downlink;
        const rtt = conn.rtt;

        if (type === "slow-2g" || type === "2g") {
          isSlow = true;
        } else if (type === "3g" && (downlink < 0.7 || rtt > 1000)) {
          isSlow = true;
        } else if (downlink > 0 && downlink < 0.3) {
          isSlow = true;
        } else if (rtt > 2000) {
          isSlow = true;
        }
      }

      // Timed fetch as additional check (runs for ALL connections)
      const start = performance.now();
      fetch("/favicon.ico?" + Date.now(), { cache: "no-store", mode: "no-cors" })
        .then(() => {
          const elapsed = performance.now() - start;
          if (elapsed > 3000 && !wasSlowRef.current && !dismissedRef.current) {
            handleSlow();
            wasSlowRef.current = true;
          } else if (elapsed < 1000 && wasSlowRef.current) {
            handleBack();
          }
        })
        .catch(() => {});

      if (isSlow && !wasSlowRef.current && !dismissedRef.current) {
        handleSlow();
      } else if (!isSlow && wasSlowRef.current) {
        handleBack();
      }

      wasSlowRef.current = isSlow || wasSlowRef.current;
    };

    const handleSlow = () => {
      wasSlowRef.current = true;
      if (dismissedRef.current) return;
      setConnectionType("slow");
      setShow(true);
    };

    const handleBack = () => {
      wasSlowRef.current = false;
      dismissedRef.current = false;
      setConnectionType("back");
      setShow(true);
      // Auto-hide "back" message after 3 seconds
      setTimeout(() => {
        setShow(false);
        setConnectionType(null);
      }, 3000);
    };

    // Listen for connection change events
    const nav = navigator as any;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn) {
      conn.addEventListener("change", checkConnection);
    }

    // Check periodically
    checkConnection();
    checkIntervalRef.current = setInterval(checkConnection, 15000);

    return () => {
      if (conn) {
        conn.removeEventListener("change", checkConnection);
      }
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, []);

  const handleDismiss = () => {
    setShow(false);
    dismissedRef.current = true;
    // Reset after 60 seconds so it can show again
    setTimeout(() => {
      dismissedRef.current = false;
    }, 60000);
  };

  if (!show) return null;

  const isSlow = connectionType === "slow";

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[99999] flex justify-center"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + var(--cap-status-bar-height, 8px))",
      }}
    >
      {/* Whole pill dismisses on tap - same rule as the action toasts. */}
      <button
        onClick={handleDismiss}
        className="mx-4 mt-2 flex items-center gap-2 px-3 py-1.5 rounded-full max-w-md w-fit cursor-pointer active:scale-95 transition-transform"
        style={{
          background: isSlow ? "#eab308" : "#22c55e",
          boxShadow: isSlow
            ? "0 4px 16px rgba(234, 179, 8, 0.3)"
            : "0 4px 16px rgba(34, 197, 94, 0.3)",
          animation: "slideDown 0.3s ease-out",
        }}
      >
        {isSlow ? (
          <WifiOff className="w-3.5 h-3.5 text-white shrink-0" />
        ) : (
          <Wifi className="w-3.5 h-3.5 text-white shrink-0" />
        )}
        <p className="text-xs font-semibold text-white whitespace-nowrap">
          {isSlow ? "Slow connection" : "Back online"}
        </p>
      </button>
    </div>
  );
}