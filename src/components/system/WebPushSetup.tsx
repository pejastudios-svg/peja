"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { isCapacitor } from "@/lib/ambientTracker";
import { registerWebPush, webPushSupported } from "@/lib/firebaseWebPush";

// Web push lifecycle (the native apps use the Capacitor plugin instead):
//  - permission already granted: silently refresh the token on load.
//  - permission not asked yet: a small dismissible pill offers to enable
//    alerts. Shown only where web push actually works (iOS Home Screen
//    app, desktop browsers) - Android browser users are pushed toward
//    the Play Store app instead, so no pill there.

const DISMISS_KEY = "peja-webpush-dismissed";
const HIDDEN_PREFIXES = ["/welcome", "/login", "/signup", "/forgot-password", "/join"];
const NAV_ROUTES = ["/", "/feed", "/search"];

function isStandalone(): boolean {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    return Boolean((navigator as unknown as { standalone?: boolean }).standalone);
  } catch {
    return false;
  }
}

export function WebPushSetup() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [showCta, setShowCta] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || isCapacitor()) return;
    let stop = false;
    (async () => {
      if (!(await webPushSupported())) return;
      if (stop) return;
      if (Notification.permission === "granted") {
        // Keep the token fresh; FCM web tokens rotate.
        registerWebPush(user.id);
        return;
      }
      if (Notification.permission === "default") {
        // Android browser: the install banner owns that surface.
        const androidBrowser = /Android/i.test(navigator.userAgent) && !isStandalone();
        if (androidBrowser) return;
        try {
          if (localStorage.getItem(DISMISS_KEY)) return;
        } catch {}
        setShowCta(true);
      }
    })();
    return () => {
      stop = true;
    };
  }, [user]);

  if (!showCta || !user) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const overNav = pathname === "/" || NAV_ROUTES.some((r) => r !== "/" && pathname.startsWith(r));

  const enable = async () => {
    setBusy(true);
    try {
      // Must run inside this click (iOS requires a user gesture).
      const ok = await registerWebPush(user.id);
      if (ok) setShowCta(false);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setShowCta(false);
  };

  return (
    <div
      className="fixed left-4 right-4 z-[39000] flex justify-center pointer-events-none"
      style={{
        bottom: overNav
          ? "calc(env(safe-area-inset-bottom, 0px) + 74px)"
          : "calc(env(safe-area-inset-bottom, 0px) + 16px)",
      }}
    >
      <div
        className="pointer-events-auto flex items-center gap-2.5 rounded-full pl-3.5 pr-1.5 py-1.5 shadow-xl max-w-sm w-full"
        style={{ background: "var(--glass-strong-bg)", border: "1px solid var(--glass-border)" }}
      >
        <Bell className="w-4 h-4 beacon-accent-text shrink-0" />
        <span className="flex-1 min-w-0 text-xs font-semibold text-dark-100 truncate">
          Get alerts when your people need you
        </span>
        <button
          onClick={enable}
          disabled={busy}
          className="px-3 py-1.5 rounded-full bg-primary-600 text-white text-xs font-bold active:scale-95 transition-transform shrink-0 disabled:opacity-60"
        >
          {busy ? "..." : "Turn on"}
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="p-1.5 rounded-full text-dark-400 active:scale-90 transition-transform shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
