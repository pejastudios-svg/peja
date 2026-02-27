import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: "peja-auth",
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// =====================================================
// CAPACITOR NATIVE SESSION HELPERS
// =====================================================

const NATIVE_SESSION_KEY = "peja-auth-native-backup";
const LS_KEY = "peja-auth";

/** True when running inside a Capacitor Android shell */
export function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  
  // Must have the Capacitor bridge AND be running on a native platform
  // (not just having the Capacitor JS package installed)
  const cap = (window as any).Capacitor;
  if (!cap) return false;
  
  // Capacitor.isNativePlatform() returns true only inside actual native shells
  if (typeof cap.isNativePlatform === "function") {
    return cap.isNativePlatform();
  }
  
  // Fallback: check platform
  if (cap.getPlatform && typeof cap.getPlatform === "function") {
    const platform = cap.getPlatform();
    return platform === "android" || platform === "ios";
  }
  
  // Final fallback: check user agent for Android WebView
  const ua = navigator.userAgent || "";
  return /Android/.test(ua) && /wv/.test(ua);
}

/**
 * Check if a session string from storage is actually valid
 * (has access_token, refresh_token, not empty/null)
 */
function isValidSessionString(value: string | null | undefined): boolean {
  if (!value || value === "null" || value === "undefined" || value === "{}" || value.length < 50) return false;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return false;
    // Supabase stores session as an object with access_token and refresh_token
    // It can be nested: { currentSession: { access_token, refresh_token } }
    // Or flat: { access_token, refresh_token }
    if (typeof parsed.access_token === "string" && typeof parsed.refresh_token === "string") return true;
    if (typeof parsed.currentSession?.access_token === "string" && typeof parsed.currentSession?.refresh_token === "string") return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Call ONCE before supabase.auth.getSession().
 * Reads the session from native Preferences and writes it
 * into localStorage so Supabase picks it up synchronously.
 */
export async function restoreNativeSession(): Promise<void> {
  if (!isCapacitorNative()) return;

  try {
    const { Preferences } = await import("@capacitor/preferences");

    // Check if localStorage already has a VALID session
    const current = localStorage.getItem(LS_KEY);

    if (isValidSessionString(current)) {
      // localStorage has a valid session — back it up to native
      await Preferences.set({ key: NATIVE_SESSION_KEY, value: current! });
      return;
    }

    // localStorage is empty or invalid — try to restore from native
    const { value: saved } = await Preferences.get({ key: NATIVE_SESSION_KEY });

    if (isValidSessionString(saved)) {
      localStorage.setItem(LS_KEY, saved!);
    } else {
    }
  } catch (err) {
  }
}

/**
 * Call periodically and on visibility-change / pagehide
 * to keep the native backup in sync.
 */
export async function syncSessionToNative(): Promise<void> {
  if (!isCapacitorNative()) return;

  try {
    const { Preferences } = await import("@capacitor/preferences");
    const session = localStorage.getItem(LS_KEY);

    if (isValidSessionString(session)) {
      await Preferences.set({ key: NATIVE_SESSION_KEY, value: session! });
    }
    // If localStorage session is invalid, do NOT overwrite native backup.
    // The native backup may still be valid and needed for restore on next launch.
  } catch {}
}

/**
 * Call on sign-out to wipe the native backup.
 */
export async function clearNativeSession(): Promise<void> {
  if (!isCapacitorNative()) return;

  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key: NATIVE_SESSION_KEY });
  } catch {}
}