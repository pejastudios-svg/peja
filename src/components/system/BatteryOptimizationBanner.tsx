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
    // just toggled the setting in the system dialog we opened.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const handleEnable = useCallback(async () => {
    setRequesting(true);
    try {
      await DeviceSettings.requestIgnoreBatteryOptimizations();
    } catch {
      // The visibilitychange re-check will reconcile state either way.
    } finally {
      setRequesting(false);
    }
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
      <div className="glass-card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
          <BatteryCharging className="w-5 h-5 text-green-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-dark-200">Turn off battery optimization</p>
          <p className="text-xs text-dark-400">
            Lets location keep updating during an SOS or check-in when Peja is
            closed. This won't affect your other apps.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleEnable}
          disabled={requesting}
          className="shrink-0"
        >
          Turn off
        </Button>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1 rounded-lg text-dark-500 hover:text-dark-300 hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
