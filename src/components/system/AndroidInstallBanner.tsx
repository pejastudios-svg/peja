"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Share, Smartphone, SquarePlus, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { isCapacitor } from "@/lib/ambientTracker";

// Slim, dismissible install nudge on the mobile web, per platform:
//  - Android: native install prompt when the browser offers one,
//    Play Store link otherwise.
//  - iOS: no install API exists, so a small walkthrough modal shows the
//    Share -> Add to Home Screen steps (standalone PWA with push since
//    iOS 16.4 - the real iOS story until the App Store account lands).
// Never inside the app, never when already installed, never after
// dismissal, and never over onboarding/auth screens.

const DISMISS_KEY = "peja-install-banner-dismissed";
const PLAY_URL = "https://play.google.com/store/apps/details?id=com.peja.app";
const HIDDEN_PREFIXES = ["/welcome", "/login", "/signup", "/forgot-password", "/join"];
const NAV_ROUTES = ["/", "/feed", "/search"];

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function detectPlatform(): "android" | "ios" | null {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  // iPadOS 13+ reports itself as Mac; the touch check catches it.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  return null;
}

function isStandalone(): boolean {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    // Old iOS Safari signal.
    return Boolean((navigator as unknown as { standalone?: boolean }).standalone);
  } catch {
    return false;
  }
}

export function AndroidInstallBanner() {
  const pathname = usePathname();
  const [platform, setPlatform] = useState<"android" | "ios" | null>(null);
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isCapacitor()) return; // inside the app
    if (isStandalone()) return; // already installed as a PWA
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {}
    setPlatform(detectPlatform());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!platform) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const overNav = pathname === "/" || NAV_ROUTES.some((r) => r !== "/" && pathname.startsWith(r));

  const act = () => {
    if (platform === "android") {
      const p = deferredPrompt.current;
      if (p) p.prompt().catch(() => window.open(PLAY_URL, "_blank"));
      else window.open(PLAY_URL, "_blank");
    } else {
      setIosHelpOpen(true);
    }
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setPlatform(null);
  };

  return (
    <>
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
            onClick={act}
            className="px-3 py-1.5 rounded-full bg-primary-600 text-white text-xs font-bold active:scale-95 transition-transform shrink-0"
          >
            {platform === "ios" ? "Add it" : "Get it"}
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

      {/* iOS walkthrough: Safari has no install API, so show the steps. */}
      <Modal isOpen={iosHelpOpen} onClose={() => setIosHelpOpen(false)} title="Add peja to your Home Screen">
        <div className="space-y-4">
          <p className="text-sm text-dark-400">
            Two taps and peja works like an app, with its own icon and full screen.
          </p>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-2xl bg-dark-800/60 border border-dark-700 p-3">
              <div className="w-9 h-9 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
                <Share className="beacon-accent-text w-4.5 h-4.5" />
              </div>
              <p className="text-sm text-dark-100">
                Tap the <span className="font-semibold">Share</span> button in Safari&apos;s toolbar
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-dark-800/60 border border-dark-700 p-3">
              <div className="w-9 h-9 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
                <SquarePlus className="beacon-accent-text w-4.5 h-4.5" />
              </div>
              <p className="text-sm text-dark-100">
                Scroll down and tap <span className="font-semibold">Add to Home Screen</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setIosHelpOpen(false);
              dismiss();
            }}
            className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.98] transition-transform"
          >
            Got it
          </button>
        </div>
      </Modal>
    </>
  );
}
