import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

/** Epoch seconds from a JWT exp claim, or 0 when unparsable. */
function jwtExpSeconds(token: string): number {
  const payload = jwtPayload(token);
  return typeof payload?.exp === "number" ? payload.exp : 0;
}

/** User id from a JWT sub claim, or empty when unparsable. */
function jwtSub(token: string): string {
  const payload = jwtPayload(token);
  return typeof payload?.sub === "string" ? payload.sub : "";
}

function jwtPayload(token: string): any {
  try {
    return JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
  } catch {
    return null;
  }
}

// Short-TTL cache so the storage adapter's per-read bridge call stays cheap.
// Native rotations happen at most hourly; 5s of staleness is harmless.
let nativeTokensCache: {
  at: number;
  pair: { accessToken: string; refreshToken: string } | null;
} | null = null;

async function readNativeTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const now = Date.now();
  if (nativeTokensCache && now - nativeTokensCache.at < 5000) {
    return nativeTokensCache.pair;
  }
  try {
    const { default: SMLLocation } = await import("@/lib/smlLocation");
    const native = await SMLLocation.getTokens();
    const pair =
      native?.accessToken && native?.refreshToken
        ? { accessToken: native.accessToken, refreshToken: native.refreshToken }
        : null;
    // Cache only successful reads. Caching a FAILED bridge call as "no
    // tokens" would poison the whole cold-start sequence (constructor
    // recovery, adoption, first getSession all read within the TTL) and
    // let supabase-js replay a stale refresh token after one hiccup.
    nativeTokensCache = { at: now, pair };
    return pair;
  } catch {
    return nativeTokensCache?.pair ?? null;
  }
}

/**
 * Storage adapter for supabase-js that merges in the native services'
 * session pair whenever it is NEWER than the persisted one.
 *
 * Why this exists: the SML/SOS foreground services refresh the Supabase
 * session natively while the app is backgrounded or killed, and Supabase
 * ROTATES the refresh token on every refresh. supabase-js refreshes from its
 * own constructor and its own visibilitychange listener, before any app code
 * can run, so an ordering-based "adopt the native pair first" fix can never
 * win. Replaying the consumed token trips GoTrue reuse detection and revokes
 * the whole session family: forced logout mid check-in or SOS, and dead
 * native tracking. Intercepting at the storage layer is structural: EVERY
 * read supabase-js performs (constructor recovery, resume recovery, auto
 * refresh ticks, getSession) sees the newest pair, and the merge needs no
 * network so it also works on an offline resume.
 */
const nativeMergedStorage = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    if (key !== LS_KEY || !isCapacitorNative()) return raw;

    try {
      const native = await readNativeTokens();
      if (!native) return raw;

      const nativeExp = jwtExpSeconds(native.accessToken);
      if (!nativeExp) return raw;

      let parsed: any = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }
      // Session shape is flat ({ access_token, ... }) on current supabase-js.
      // A v1-era artifact can still hold the nested currentSession shape;
      // lift it to flat, because auth-js v2's session validation rejects the
      // nested form and would sign the user out.
      if (!parsed?.access_token && parsed?.currentSession?.access_token) {
        parsed = parsed.currentSession;
      }
      if (!parsed?.access_token) return raw;

      const jsExp = jwtExpSeconds(parsed.access_token);
      if (nativeExp <= jsExp) return raw;

      // Never merge another account's tokens over this session.
      const jsSub = jwtSub(parsed.access_token);
      const nativeSub = jwtSub(native.accessToken);
      if (jsSub && nativeSub && jsSub !== nativeSub) return raw;

      parsed.access_token = native.accessToken;
      parsed.refresh_token = native.refreshToken;
      parsed.expires_at = nativeExp;

      // The bridge read above awaited; if anything (a concurrent sign-in's
      // session save) wrote the key meanwhile, our merge is based on a stale
      // snapshot. Yield the newer write instead of clobbering it.
      const current = window.localStorage.getItem(key);
      if (current !== raw) return current;

      const merged = JSON.stringify(parsed);
      try {
        window.localStorage.setItem(key, merged);
      } catch {}
      return merged;
    } catch {
      return raw;
    }
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  },
  removeItem(key: string): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {}
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: "peja-auth",
    storage: nativeMergedStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// =====================================================
// CAPACITOR NATIVE SESSION HELPERS
// =====================================================

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
 * Call on sign-out to wipe the native backup, including the shared token
 * store the location services refresh from. Without the second wipe a valid
 * refresh token for the old account would stay on disk indefinitely.
 */
export async function clearNativeSession(): Promise<void> {
  if (!isCapacitorNative()) return;

  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key: NATIVE_SESSION_KEY });
  } catch {}

  try {
    const { default: SMLLocation } = await import("@/lib/smlLocation");
    await SMLLocation.clearSession();
  } catch {}
  // Drop the adapter's short-TTL cache so a just-wiped pair can't be merged
  // back into a new session for the next few seconds.
  nativeTokensCache = null;
}

/**
 * Recovery for the case the storage adapter cannot handle: localStorage has
 * NO session at all (WebView storage wiped in the background) while the
 * native store still holds a live pair. The adapter can only merge into an
 * existing session object; here we rebuild one via supabase.auth.setSession,
 * which fetches the user for the pair. Call after restoreNativeSession on
 * startup and on resume. When localStorage already has a session, the
 * adapter has merged the newest pair into it and this is a no-op.
 */
export async function adoptNativeSessionIfNewer(): Promise<void> {
  if (!isCapacitorNative()) return;

  try {
    const native = await readNativeTokens();
    if (!native) return;

    const nativeExp = jwtExpSeconds(native.accessToken);
    if (!nativeExp) return;

    // Compare against the persisted pair directly. Going through
    // supabase.auth.getSession() here could itself trigger the stale
    // refresh this function exists to prevent.
    let jsAccess = "";
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        jsAccess =
          parsed?.access_token || parsed?.currentSession?.access_token || "";
      }
    } catch {}

    if (jsAccess && nativeExp <= jwtExpSeconds(jsAccess)) return;
    if (jsAccess) {
      const jsSub = jwtSub(jsAccess);
      const nativeSub = jwtSub(native.accessToken);
      if (jsSub && nativeSub && jsSub !== nativeSub) return;
    }

    await supabase.auth.setSession({
      access_token: native.accessToken,
      refresh_token: native.refreshToken,
    });
  } catch {}
}