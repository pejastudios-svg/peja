import { registerPlugin } from "@capacitor/core";

interface DeviceSettingsPlugin {
  /** Whether Peja is exempt from battery optimization (good state). */
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  /** Opens the system "allow to run in background" dialog. */
  requestIgnoreBatteryOptimizations(): Promise<void>;
  /** Whether "Allow all the time" background location is granted. */
  hasBackgroundLocation(): Promise<{ granted: boolean }>;
  /** Routes to the app permission screen so the user can pick "all the time". */
  requestBackgroundLocation(): Promise<void>;
  /** Opens the app's system settings page. */
  openAppSettings(): Promise<void>;
}

const DeviceSettings = registerPlugin<DeviceSettingsPlugin>("DeviceSettings");

/**
 * True only inside the native Android shell, where the battery /
 * background-location settings exist and the plugin is registered. On the
 * web (and iOS, which has its own model) the helpers below short-circuit to
 * a "nothing to fix" result so callers can stay platform-agnostic.
 */
export function isNativeAndroid(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as any).Capacitor;
  try {
    return (
      !!cap &&
      cap.isNativePlatform?.() === true &&
      cap.getPlatform?.() === "android"
    );
  } catch {
    return false;
  }
}

export interface LocationReadiness {
  /** Native Android shell — only then are the flags actionable. */
  isNative: boolean;
  /** Battery optimization is ON (bad — it can kill the tracking service). */
  batteryOptimized: boolean;
  /** "Allow all the time" location is granted (needed for background fixes). */
  backgroundLocation: boolean;
}

/**
 * Reads the current OS-level readiness for background location tracking.
 * Never throws — a failed bridge call is treated as "already fine" so a
 * plugin hiccup can never block the user from starting a session.
 */
export async function getLocationReadiness(): Promise<LocationReadiness> {
  if (!isNativeAndroid()) {
    return { isNative: false, batteryOptimized: false, backgroundLocation: true };
  }

  let batteryOptimized = false;
  let backgroundLocation = true;

  try {
    const { ignoring } = await DeviceSettings.isIgnoringBatteryOptimizations();
    batteryOptimized = !ignoring;
  } catch {
    // Treat as fine — don't surface a prompt we can't verify.
  }

  try {
    const { granted } = await DeviceSettings.hasBackgroundLocation();
    backgroundLocation = granted;
  } catch {
    // Treat as fine.
  }

  return { isNative: true, batteryOptimized, backgroundLocation };
}

export default DeviceSettings;
