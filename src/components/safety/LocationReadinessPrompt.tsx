"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BatteryCharging,
  MapPin,
  CheckCircle,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { Portal } from "@/components/ui/Portal";
import DeviceSettings, {
  getLocationReadiness,
  isNativeAndroid,
} from "@/lib/deviceSettings";

/**
 * Session-start readiness prompt for background location tracking.
 *
 * Listens for the global `peja-session-started` event (fired by the SOS and
 * SML start flows). On native Android it checks the two OS-level settings the
 * tracking service depends on — battery-optimization exemption and "Allow all
 * the time" location — and, if either is missing, shows a sheet that lets the
 * user fix each in one tap. Does nothing on web/iOS or when everything is
 * already granted, so a fully set-up user never sees it.
 */
export function LocationReadinessPrompt() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [batteryOk, setBatteryOk] = useState(true);
  const [locationOk, setLocationOk] = useState(true);

  const evaluate = useCallback(async () => {
    if (!isNativeAndroid()) return;
    const r = await getLocationReadiness();
    const needsBattery = r.batteryOptimized;
    const needsLocation = !r.backgroundLocation;
    setBatteryOk(!needsBattery);
    setLocationOk(!needsLocation);
    if (needsBattery || needsLocation) setOpen(true);
  }, []);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 200);
  }, []);

  // Re-read current state, flip the checkmarks, and auto-close once both are
  // resolved — so the prompt updates live without a manual refresh.
  const recheck = useCallback(async () => {
    const r = await getLocationReadiness();
    setBatteryOk(!r.batteryOptimized);
    setLocationOk(r.backgroundLocation);
    if (!r.batteryOptimized && r.backgroundLocation) close();
  }, [close]);

  // Poll for a few seconds after a fix is triggered. The OS can report the
  // new state slightly after its settings screen/dialog closes, and the
  // resume event may race ahead of it.
  const pollAfterFix = useCallback(() => {
    let n = 0;
    const poll = setInterval(async () => {
      n += 1;
      await recheck();
      if (n >= 8) clearInterval(poll);
    }, 1000);
  }, [recheck]);

  useEffect(() => {
    const onSession = () => { void evaluate(); };
    window.addEventListener("peja-session-started", onSession);
    return () => window.removeEventListener("peja-session-started", onSession);
  }, [evaluate]);

  // Re-check when returning from a system settings screen. The battery dialog
  // is a lightweight overlay that doesn't reliably fire visibilitychange in
  // the WebView, so also listen to Capacitor's appStateChange.
  useEffect(() => {
    if (!open) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void recheck();
    };
    document.addEventListener("visibilitychange", onVisible);

    let removeAppListener: (() => void) | undefined;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) void recheck();
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
  }, [open, recheck]);

  const fixBattery = useCallback(async () => {
    try { await DeviceSettings.requestIgnoreBatteryOptimizations(); } catch {}
    pollAfterFix();
  }, [pollAfterFix]);

  const fixLocation = useCallback(async () => {
    try { await DeviceSettings.requestBackgroundLocation(); } catch {}
    pollAfterFix();
  }, [pollAfterFix]);

  if (!open) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[10000]"
        onClick={close}
      />
      <div className="fixed inset-0 z-[10001] flex items-end sm:items-center justify-center pointer-events-none">
        <div
          className={`w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-5 pointer-events-auto ${closing ? "animate-bounce-out" : "animate-bounce-in"}`}
          style={{
            background: "var(--glass-strong-bg)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 -10px 40px rgba(0,0,0,0.5)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-1 pb-2 sm:hidden">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6 text-primary-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-dark-100">Keep tracking alive</h2>
              <p className="text-xs text-dark-400">
                Two phone settings keep your location updating when Peja is closed.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {!batteryOk && (
              <ReadinessRow
                icon={<BatteryCharging className="w-5 h-5 text-green-400" />}
                tint="bg-green-500/15"
                title="Turn off battery optimization"
                subtitle="Stops your phone from killing tracking in the background."
                onClick={fixBattery}
              />
            )}
            {batteryOk && (
              <ReadinessDone title="Battery optimization is off" />
            )}

            {!locationOk && (
              <ReadinessRow
                icon={<MapPin className="w-5 h-5 text-primary-400" />}
                tint="bg-primary-500/15"
                title="Allow location all the time"
                subtitle="Open Permissions → Location, then pick 'Allow all the time'."
                onClick={fixLocation}
              />
            )}
            {locationOk && (
              <ReadinessDone title="Location set to all the time" />
            )}
          </div>

          <button
            onClick={close}
            className="w-full mt-4 py-3 rounded-xl text-sm font-semibold bg-white/5 text-dark-200 border border-white/10 active:scale-[0.98] transition-transform"
          >
            {batteryOk && locationOk ? "All set" : "Not now"}
          </button>
        </div>
      </div>
    </Portal>
  );
}

function ReadinessRow({
  icon,
  tint,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/[0.07] transition-colors text-left"
    >
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${tint}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-dark-100">{title}</p>
        <p className="text-[11px] text-dark-400 leading-tight">{subtitle}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
    </button>
  );
}

function ReadinessDone({ title }: { title: string }) {
  return (
    <div className="w-full flex items-center gap-3 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-green-500/15">
        <CheckCircle className="w-5 h-5 text-green-400" />
      </div>
      <p className="text-sm font-medium text-green-400">{title}</p>
    </div>
  );
}
