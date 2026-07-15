"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Smartphone, X } from "lucide-react";

// Slim, dismissible nudge for Android visitors on peja.life: the native
// app is the real experience (background tracking, SOS services). Shown
// only on the mobile web, never inside the app, never after dismissal.

const DISMISS_KEY = "peja-android-banner-dismissed";
const PLAY_URL = "https://play.google.com/store/apps/details?id=com.peja.app";
// Keep onboarding and auth screens clean.
const HIDDEN_PREFIXES = ["/welcome", "/login", "/signup", "/forgot-password", "/join"];
// Routes where the bottom nav is visible (banner floats above it).
const NAV_ROUTES = ["/", "/feed", "/search"];

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function AndroidInstallBanner() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if ("Capacitor" in window) return; // already in the app
    if (!/Android/i.test(navigator.userAgent)) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {}
    setShow(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!show) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const overNav = pathname === "/" || NAV_ROUTES.some((r) => r !== "/" && pathname.startsWith(r));

  const install = () => {
    const p = deferredPrompt.current;
    if (p) p.prompt().catch(() => window.open(PLAY_URL, "_blank"));
    else window.open(PLAY_URL, "_blank");
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setShow(false);
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
        <Smartphone className="w-4 h-4 beacon-accent-text shrink-0" />
        <span className="flex-1 min-w-0 text-xs font-semibold text-dark-100 truncate">
          peja is better as an app
        </span>
        <button
          onClick={install}
          className="px-3 py-1.5 rounded-full bg-primary-600 text-white text-xs font-bold active:scale-95 transition-transform shrink-0"
        >
          Get it
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
