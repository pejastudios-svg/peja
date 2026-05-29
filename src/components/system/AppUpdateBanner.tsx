"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";

// Once the user dismisses (X) a given update, remember it by the available
// version code so we don't nag on every open — but a NEWER version still
// surfaces. Stored in localStorage so it survives across launches.
const DISMISS_KEY = "peja:update-banner-dismissed-version";

export function AppUpdateBanner() {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

  // Ask Google Play (via the In-App Update API) whether a newer version is
  // live. Throws on web / when Play services are unavailable, so it's fully
  // guarded — the banner simply never shows in those environments.
  const check = useCallback(async () => {
    try {
      if (typeof window === "undefined") return;
      const cap = (window as any).Capacitor;
      if (!cap?.isNativePlatform?.()) return;
      if (cap.getPlatform?.() !== "android") return;

      const { AppUpdate, AppUpdateAvailability } = await import(
        "@capawesome/capacitor-app-update"
      );
      const info = await AppUpdate.getAppUpdateInfo();
      if (info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) {
        return;
      }

      const version = info.availableVersionCode || "new";
      let dismissed: string | null = null;
      try {
        dismissed = localStorage.getItem(DISMISS_KEY);
      } catch {}
      if (dismissed === version) return;

      setAvailableVersion(version);
      setLeaving(false);
      setShow(true);
    } catch {
      // No update info available — nothing to show.
    }
  }, []);

  useEffect(() => {
    check();
    // Re-check each time the app returns to the foreground (Capacitor resume).
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [check]);

  const close = useCallback(
    (remember: boolean) => {
      if (remember && availableVersion) {
        try {
          localStorage.setItem(DISMISS_KEY, availableVersion);
        } catch {}
      }
      setLeaving(true);
      setTimeout(() => {
        setShow(false);
        setLeaving(false);
      }, 320);
    },
    [availableVersion]
  );

  const openStore = useCallback(async () => {
    try {
      const { AppUpdate } = await import("@capawesome/capacitor-app-update");
      // No package name = current app's listing on the Play Store.
      await AppUpdate.openAppStore();
    } catch {}
    // Fade out after handing off to the store. Don't persist the dismissal —
    // if they return without updating, a later check can surface it again.
    close(false);
  }, [close]);

  if (!show) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999990] flex justify-center pointer-events-none"
      style={{
        paddingTop:
          "calc(env(safe-area-inset-top, 0px) + var(--cap-status-bar-height, 4px))",
      }}
    >
      <div
        className="pointer-events-auto mx-4 mt-1 flex items-center gap-2 pl-3 pr-2 py-2 rounded-full max-w-sm w-auto"
        style={{
          background: "rgba(124, 58, 237, 0.15)",
          border: "1px solid rgba(124, 58, 237, 0.35)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
          opacity: leaving ? 0 : 1,
          transform: leaving ? "translateY(-8px)" : "translateY(0)",
          transition: "opacity 0.3s ease, transform 0.3s ease",
          animation: leaving ? undefined : "slideDown 0.3s ease-out",
        }}
      >
        <ArrowUpCircle
          className="w-4 h-4 shrink-0"
          style={{ color: "#a78bfa" }}
        />
        <span className="text-xs font-medium" style={{ color: "#c4b5fd" }}>
          Update available
        </span>
        <button
          type="button"
          onClick={openStore}
          className="text-xs font-semibold px-3 py-1 rounded-full shrink-0 active:scale-95 transition-transform"
          style={{ background: "#7c3aed", color: "#ffffff" }}
        >
          Update
        </button>
        <button
          type="button"
          onClick={() => close(true)}
          aria-label="Dismiss"
          className="p-1 rounded-full hover:bg-white/10 active:bg-white/20 transition-colors shrink-0"
          style={{ color: "rgba(196, 181, 253, 0.85)" }}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
