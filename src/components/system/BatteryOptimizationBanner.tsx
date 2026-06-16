"use client";

import { useCallback, useEffect, useState } from "react";
import { BatteryCharging, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import DeviceSettings, { isNativeAndroid } from "@/lib/deviceSettings";

const DISMISS_KEY = "peja-battery-banner-dismissed";

/**
 * Rectangular top banner (styled like the "Complete your profile" prompt)
 * that appears on native Android when Peja is still subject to battery
 * optimization. One tap opens the system exemption dialog. Background
 * location tracking (SOS + SML) is throttled or killed by Doze / OEM
 * battery managers without this exemption, so this nudge keeps the
 * tracking service alive while the app is closed.
 *
 * Hidden on web/iOS, hidden once the exemption is granted, and dismissible
 * for the current app session.
 */
export function BatteryOptimizationBanner() {
  const [show, setShow] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const refresh = useCallback(async () => {
    if (!isNativeAndroid()) {
      setShow(false);
      return;
    }
    if (sessionStorage.getItem(DISMISS_KEY) === "true") {
      setShow(false);
      return;
    }
    try {
      const { ignoring } = await DeviceSettings.isIgnoringBatteryOptimizations();
      setShow(!ignoring);
    } catch {
      setShow(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Re-check when the app returns to the foreground — the user may have
    // just toggled the setting. The battery dialog is a lightweight overlay
    // that doesn't always fire visibilitychange in the WebView, so we also
    // listen to Capacitor's appStateChange (the reliable native signal).
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    let removeAppListener: (() => void) | undefined;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) refresh();
        })
      )
      .then((handle) => {
        removeAppListener = () => void handle.remove();
      })
      .catch(() => {});

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      removeAppListener?.();
    };
  }, [refresh]);

  const handleEnable = useCallback(async () => {
    setRequesting(true);
    try {
      await DeviceSettings.requestIgnoreBatteryOptimizations();
    } catch {
      // The re-check listeners below reconcile state either way.
    } finally {
      setRequesting(false);
    }
    // The OS may report the new state slightly after the dialog closes, and
    // the resume event can race ahead of it. Poll a few times to be sure the
    // banner disappears the moment the exemption is granted — no manual
    // refresh needed.
    let n = 0;
    const poll = setInterval(async () => {
      n += 1;
      try {
        const { ignoring } = await DeviceSettings.isIgnoringBatteryOptimizations();
        if (ignoring) {
          setShow(false);
          clearInterval(poll);
          return;
        }
      } catch {}
      if (n >= 6) clearInterval(poll);
    }, 1000);
  }, []);

  const handleDismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "true");
    } catch {}
    setShow(false);
  }, []);

  if (!show) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4">
      <div className="glass-card p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
            <BatteryCharging className="w-5 h-5 text-green-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-dark-100">
              Turn off battery optimization
            </p>
            <p className="text-xs text-dark-400 mt-0.5 leading-relaxed">
              Keeps your location updating during an SOS or check-in, even when
              Peja is closed. Won't affect your other apps.
            </p>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-dark-500 hover:text-dark-300 hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleEnable}
          disabled={requesting}
          className="w-full mt-3"
        >
          Turn off battery optimization
        </Button>
      </div>
    </div>
  );
}
