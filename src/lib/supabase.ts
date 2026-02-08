import { createClient } from "@supabase/supabase-js";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const AUTH_STORAGE_KEY = "peja-auth";
const NATIVE_BACKUP_KEY = "peja-auth-backup";
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: AUTH_STORAGE_KEY,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
// -------------------------------------------------------
// Capacitor helpers
// -------------------------------------------------------
export function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    (/Android/.test(ua) && /wv/.test(ua)) ||
    (window as any).Capacitor !== undefined
  );
}

export async function restoreNativeSession(): Promise<boolean> {
  if (!isCapacitorNative()) return false;
  try {
    const { Preferences } = await import("@capacitor/preferences");

    const current = localStorage.getItem(AUTH_STORAGE_KEY);
    const hasValid =
      current &&
      current !== "null" &&
      current !== "{}" &&
      current.length > 10;
    if (hasValid) {

      await Preferences.set({ key: NATIVE_BACKUP_KEY, value: current });
      console.log("[Auth] localStorage session valid, backed up to native");
      return false; 
    }
    const { value: saved } = await Preferences.get({ key: NATIVE_BACKUP_KEY });
    if (saved && saved !== "null" && saved !== "{}" && saved.length > 10) {
      console.log("[Auth] Restoring session from native storage → localStorage");
      localStorage.setItem(AUTH_STORAGE_KEY, saved);
      return true; 
    }
    console.log("[Auth] No session in native storage either");
    return false;
  } catch (err) {
    console.warn("[Auth] restoreNativeSession failed:", err);
    return false;
  }
}

export async function syncSessionToNative(): Promise<void> {
  if (!isCapacitorNative()) return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const session = localStorage.getItem(AUTH_STORAGE_KEY);
    if (session && session !== "null" && session !== "{}" && session.length > 10) {
      await Preferences.set({ key: NATIVE_BACKUP_KEY, value: session });
    }
  } catch {}
}

export async function clearNativeSession(): Promise<void> {
  if (!isCapacitorNative()) return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key: NATIVE_BACKUP_KEY });
    console.log("[Auth] Native session backup cleared");
  } catch {}
}