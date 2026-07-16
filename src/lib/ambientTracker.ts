import { Capacitor, registerPlugin } from "@capacitor/core";

// JS bridge to the native always-on presence service (Android). The
// service beats the user's location to /api/presence/beat every ~3 min,
// authenticated by a long-lived device key, even with the app closed.

interface AmbientLocationPlugin {
  start(options: { endpoint: string; key: string }): Promise<{ started: boolean }>;
  stop(): Promise<{ stopped: boolean }>;
  isTracking(): Promise<{ tracking: boolean }>;
}

export const AmbientLocation = registerPlugin<AmbientLocationPlugin>("AmbientLocation");

/** localStorage: "on" | "off" | unset (never asked). Device-scoped on
 * purpose: background tracking is a property of THIS phone. */
export const AMBIENT_PREF_KEY = "peja-ambient-tracking";
/** The minted device key (also held in native prefs). */
export const AMBIENT_KEY_STORAGE = "peja-ambient-device-key";
/** Fired by the settings toggle; the bootstrap reacts. */
export const AMBIENT_CHANGED_EVENT = "peja-ambient-changed";

export function isCapacitor(): boolean {
  // NOT `"Capacitor" in window`: importing @capacitor/core defines the
  // global in ordinary browsers too. isNativePlatform() is the truth.
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
