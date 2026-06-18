"use client";

import { useEffect, useRef, useState } from "react";
import { Radio, X } from "lucide-react";

/**
 * When the user starts sharing location (a Share My Location check-in or an
 * SOS), this surfaces a short, high-contrast reminder to leave Peja running.
 * Swiping the app off recents lets aggressive OEM power managers
 * (Transsion/Xiaomi/etc.) kill the tracking service; it self-revives via push,
 * but there's a gap, so keeping the app open is the most reliable path.
 *
 * It auto-dismisses after a few seconds so it never permanently covers the
 * feed/tabs, and reappears the next time a session starts. The BottomNav keeps
 * a persistent active indicator, so the reminder doesn't need to linger.
 */
const VISIBLE_MS = 9000;

export function KeepAppOpenBanner() {
  const [smlActive, setSmlActive] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const shownForSession = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleSOS = (e: any) => setSosActive(!!e.detail?.active);
    const handleSML = (e: any) => setSmlActive(!!e.detail?.active);
    window.addEventListener("peja-sos-state", handleSOS);
    window.addEventListener("peja-sml-state", handleSML);

    // Seed from localStorage (matches BottomNav's init).
    try {
      if (localStorage.getItem("peja-sos-active-id")) setSosActive(true);
      if (localStorage.getItem("peja-sml-active")) setSmlActive(true);
    } catch {}

    return () => {
      window.removeEventListener("peja-sos-state", handleSOS);
      window.removeEventListener("peja-sml-state", handleSML);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const active = smlActive || sosActive;

  // Show once per session start, then auto-hide. Reset when the session ends so
  // the next one shows again.
  useEffect(() => {
    if (active && !shownForSession.current) {
      shownForSession.current = true;
      setClosing(false);
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => hide(), VISIBLE_MS);
    } else if (!active) {
      shownForSession.current = false;
      setVisible(false);
      setClosing(false);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    }
  }, [active]);

  const hide = () => {
    setClosing(true);
    setTimeout(() => setVisible(false), 250);
  };

  if (!visible) return null;

  // SOS takes visual precedence — red and more urgent than a check-in.
  const label = sosActive ? "SOS active" : "Sharing your location";
  const bg = sosActive ? "#dc2626" : "#16a34a";

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999997] flex justify-center px-4 pointer-events-none"
      style={{
        paddingTop:
          "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 16px) + 58px)",
      }}
    >
      <div
        className="flex items-center gap-3 pl-4 pr-2.5 py-2.5 rounded-2xl max-w-md w-full pointer-events-auto"
        style={{
          background: bg,
          boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
          animation: closing ? undefined : "slideDown 0.3s ease-out",
          opacity: closing ? 0 : 1,
          transform: closing ? "translateY(-8px)" : "translateY(0)",
          transition: "opacity 0.25s ease-in, transform 0.25s ease-in",
        }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "rgba(255,255,255,0.2)" }}
        >
          <Radio className="w-4 h-4 text-white animate-pulse" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white leading-tight">{label}</p>
          <p className="text-xs text-white/90 leading-snug">
            Keep Peja open. Swiping it closed can pause location updates.
          </p>
        </div>
        <button
          type="button"
          onClick={hide}
          className="p-1.5 rounded-full hover:bg-white/15 active:bg-white/25 transition-colors shrink-0"
          aria-label="Dismiss"
          style={{ color: "rgba(255,255,255,0.9)" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
