"use client";

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { supabase, restoreNativeSession, clearNativeSession } from "@/lib/supabase";
import { presenceManager } from "@/lib/presence";
import { User as SupabaseUser, Session } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { setFlashToast } from "@/context/ToastContext";



interface User {
  id: string;
  email: string;
  phone?: string;
  full_name?: string;
  avatar_url?: string;
  occupation?: string;
  // Profile-completion fields. Surfaced so lib/profileComplete.ts can read
  // them from the in-memory user object without re-querying.
  date_of_birth?: string;
  home_address?: string;
  gender?: string;
  reputation_score?: number;
  created_at?: string;

  is_guardian?: boolean;
  is_admin?: boolean;
  is_vip?: boolean;
  is_mvp?: boolean;

  email_verified: boolean;
  phone_verified: boolean;

  last_latitude?: number;
  last_longitude?: number;
  last_location_updated_at?: string;

  status?: "active" | "suspended" | "banned";
}

interface AuthContextType {
  user: User | null;
  supabaseUser: SupabaseUser | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string, phone: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  getBearing: () => number;
  getLastPosition: () => { lat: number; lng: number } | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// =====================================================
// LOCATION TRACKER WITH COMPASS BEARING
// =====================================================
class LocationTracker {
  private watchId: number | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private lastPosition: { lat: number; lng: number } | null = null;
  private userId: string | null = null;
  private isTracking = false;
  private currentBearing: number = 0;
  private bearingListeners: ((bearing: number) => void)[] = [];

  start(userId: string) {
    if (this.isTracking) return;
    
    this.userId = userId;
    this.isTracking = true;
    

    if (typeof window === "undefined") return;

    if (navigator.geolocation) {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.handlePositionUpdate(position),
        (error) => this.handleError(error),
        {
          enableHighAccuracy: true,
          maximumAge: 30000,
          timeout: 30000,
        }
      );

      // Update location every 10 seconds
      this.updateInterval = setInterval(() => {
        this.forceUpdate();
      }, 10000);
    }

    // Start compass tracking for direction
    this.startCompassTracking();
  }

  private startCompassTracking() {
    if (typeof window === "undefined") return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      let bearing = 0;
      
      // iOS Safari
      if ((event as any).webkitCompassHeading !== undefined) {
        bearing = (event as any).webkitCompassHeading;
      } 
      // Android Chrome
      else if (event.alpha !== null) {
        bearing = 360 - event.alpha;
      }

      // Normalize to 0-360
      bearing = ((bearing % 360) + 360) % 360;
      this.currentBearing = bearing;
      this.bearingListeners.forEach(cb => cb(bearing));
    };

    // Request permission on iOS 13+
    if (typeof (DeviceOrientationEvent as any).requestPermission === "function") {
      (DeviceOrientationEvent as any).requestPermission()
        .then((response: string) => {
          if (response === "granted") {
            window.addEventListener("deviceorientation", handleOrientation, true);
          }
        })
        .catch((err: any) => {
        });
    } else {
      window.addEventListener("deviceorientation", handleOrientation, true);
    }
  }

  onBearingChange(callback: (bearing: number) => void) {
    this.bearingListeners.push(callback);
    return () => {
      this.bearingListeners = this.bearingListeners.filter(cb => cb !== callback);
    };
  }

  getBearing(): number {
    return this.currentBearing;
  }

  getLastPosition(): { lat: number; lng: number } | null {
    return this.lastPosition;
  }

  stop() {
    
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.isTracking = false;
  }

  private async handlePositionUpdate(position: GeolocationPosition) {
    const { latitude, longitude } = position.coords;

    // Only update if moved more than 10 meters
    if (this.lastPosition) {
      const distance = this.calculateDistance(
        this.lastPosition.lat,
        this.lastPosition.lng,
        latitude,
        longitude
      );

      if (distance < 0.01) {
        return;
      }
    }

    this.lastPosition = { lat: latitude, lng: longitude };
    await this.savePosition(latitude, longitude);
  }

  private forceUpdate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    
    navigator.geolocation.getCurrentPosition(
      (position) => this.handlePositionUpdate(position),
      (error) => this.handleError(error),
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 30000,
      }
    );
  }

  // Capture a single fresh fix and persist it immediately. Used on app open
  // and on every return to foreground so the passive "last known location"
  // (shown on the admin user page) is current even for users who never trigger
  // SOS/SML — the safety net for locating someone after an incident.
  async captureNow(userId?: string) {
    if (userId) this.userId = userId;
    if (!this.userId) return;
    const pos = await this.getCurrentPosition();
    if (!pos) return;

    const moved =
      !this.lastPosition ||
      this.calculateDistance(this.lastPosition.lat, this.lastPosition.lng, pos.lat, pos.lng) >= 0.01;
    this.lastPosition = { lat: pos.lat, lng: pos.lng };

    if (moved) {
      // Moved >10m — full save with a fresh reverse-geocoded address.
      await this.savePosition(pos.lat, pos.lng);
    } else {
      // Stationary — keep the timestamp current (so the admin page shows the
      // location is recent) without re-geocoding the same spot.
      try {
        await supabase
          .from("users")
          .update({
            last_latitude: pos.lat,
            last_longitude: pos.lng,
            last_location_updated_at: new Date().toISOString(),
          })
          .eq("id", this.userId);
      } catch {}
    }
  }

  private async savePosition(latitude: number, longitude: number) {
    if (!this.userId) return;

    try {
      const address = await this.getAddressFromCoords(latitude, longitude);


      const { error } = await supabase
        .from("users")
        .update({
          last_latitude: latitude,
          last_longitude: longitude,
          last_address: address,
          last_location_updated_at: new Date().toISOString(),
        })
        .eq("id", this.userId);

      if (error) {
      }
    } catch (err) {
    }
  }

  private async getAddressFromCoords(lat: number, lng: number): Promise<string> {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { headers: { "User-Agent": "Peja App" } }
      );
      
      const data = await response.json();
      
      if (data?.address) {
        const addr = data.address;
        const parts = [];
        
        if (addr.road) parts.push(addr.road);
        if (addr.suburb || addr.neighbourhood) parts.push(addr.suburb || addr.neighbourhood);
        if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village);
        if (addr.state) parts.push(addr.state);
        
        return parts.length > 0 ? parts.join(", ") : "Location found";
      }
      
      return "Location found";
    } catch {
      return "Location found";
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
        Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private handleError(error: GeolocationPositionError) {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        break;
      case error.POSITION_UNAVAILABLE:
        break;
      case error.TIMEOUT:
        break;
    }
  }

  async getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return null;
    }
    
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 30000,
          maximumAge: 30000,
        }
      );
    });
  }
}

const locationTracker = new LocationTracker();

let userProfileCache: { userId: string; profile: User; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000;
const PROFILE_LS_KEY = "peja-user-profile";

function getLocalProfile(userId: string): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_LS_KEY);
    if (!raw) return null;
    const { userId: uid, profile, timestamp } = JSON.parse(raw);
    if (uid !== userId) return null;
    if (Date.now() - timestamp > 60 * 60 * 1000) return null; // 1-hour shelf life
    return profile as User;
  } catch {
    return null;
  }
}

function readPersistedProfile(): { user: User | null; loading: boolean } {
  if (typeof window === "undefined") return { user: null, loading: true };
  try {
    const raw = localStorage.getItem(PROFILE_LS_KEY);
    if (!raw) return { user: null, loading: true };
    const { userId, profile, timestamp } = JSON.parse(raw);
    if (!userId || !profile) return { user: null, loading: true };
    if (Date.now() - timestamp > 60 * 60 * 1000) return { user: null, loading: true };
    // Also verify a Supabase session key exists — never show profile without a token
    const hasToken = Object.keys(localStorage).some(
      (k) => (k.includes("supabase") && k.includes("auth")) || k === "peja-auth"
    );
    if (!hasToken) return { user: null, loading: true };
    return { user: profile as User, loading: false };
  } catch {
    return { user: null, loading: true };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readPersistedProfile().user);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(() => readPersistedProfile().loading);
  const initRef = useRef(false);
  const fetchingRef = useRef(false);
  const signingInRef = useRef(false);
  const userRowChannelRef = useRef<RealtimeChannel | null>(null);
  const statusRef = useRef<string | null>(null);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const initAuth = async () => {
      try {
        // Step 1: On Capacitor, restore session from native storage into localStorage
        await restoreNativeSession();

        // Step 2: Get session from localStorage
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (currentSession?.user) {
          setSession(currentSession);
          setSupabaseUser(currentSession.user);
          const cachedProfile = getLocalProfile(currentSession.user.id);
          if (cachedProfile) {
            // Instantly restore from cache — UI unblocks now
            setUser(cachedProfile);
            setLoading(false);
            // Refresh profile in background without blocking
            fetchUserProfile(currentSession.user.id, true).catch(() => {});
          } else {
            await fetchUserProfile(currentSession.user.id);
          }
          checkAndStartLocationTracking(currentSession.user.id);
          presenceManager.start(currentSession.user.id);
          await startUserRowSubscription(currentSession.user.id);
        } else {
          // No cached session — try refreshing (handles expired access tokens)
          const { data: { session: refreshed } } = await supabase.auth.refreshSession();
          if (refreshed?.user) {
            setSession(refreshed);
            setSupabaseUser(refreshed.user);
            const cachedProfile = getLocalProfile(refreshed.user.id);
            if (cachedProfile) {
              setUser(cachedProfile);
              setLoading(false);
              fetchUserProfile(refreshed.user.id, true).catch(() => {});
            } else {
              await fetchUserProfile(refreshed.user.id);
            }
            checkAndStartLocationTracking(refreshed.user.id);
            presenceManager.start(refreshed.user.id);
            await startUserRowSubscription(refreshed.user.id);
          }
        }
      } catch (error) {
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(() => {
      // Only force-clear loading if a fetch isn't already in progress
      if (!fetchingRef.current) setLoading(false);
    }, 12000);

    initAuth().finally(() => {
      clearTimeout(timeoutId);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {

        // TOKEN_REFRESHED: just update session reference, do nothing else
        if (event === 'TOKEN_REFRESHED') {
          if (newSession) setSession(newSession);
          return;
        }

        setSession(newSession);

        if (newSession?.user) {
          setSupabaseUser(newSession.user);
          
          if (event === 'SIGNED_IN') {
            // Clean up OAuth hash fragment from URL (once)
            if (window.location.hash) {
              setTimeout(() => {
                window.history.replaceState(null, "", window.location.pathname);
              }, 1000);
            }
            // Only fetch profile on SIGNED_IN if signIn/signUp isn't handling it
            
            if (!signingInRef.current) {
              fetchUserProfile(newSession.user.id).catch(() => {});
            }
            startUserRowSubscription(newSession.user.id).catch(() => {});
            checkAndStartLocationTracking(newSession.user.id);
            presenceManager.start(newSession.user.id);
          }
                } else {
          if (event === 'SIGNED_OUT') {
            // Verify this is a REAL sign-out, not a false one from rate-limited token refresh.
            // Check if localStorage still has a session — if so, the sign-out is fake.
            const storedSession = typeof window !== "undefined" ? localStorage.getItem("peja-auth") : null;
            let hasStoredSession = false;
            try {
              if (storedSession) {
                const parsed = JSON.parse(storedSession);
                hasStoredSession = !!(parsed?.access_token || parsed?.currentSession?.access_token);
              }
            } catch {}

            if (hasStoredSession) {
              // Don't clear anything — the session is still valid, just rate-limited
              return;
            }

            setUser(null);
            setSupabaseUser(null);
            setSession(null);
            userProfileCache = null;
            try { localStorage.removeItem(PROFILE_LS_KEY); } catch {}
            locationTracker.stop();
            presenceManager.stop();
          }
        }
      }
    );

    // Re-validate session when app resumes from background (Capacitor fix)
    // Only runs on Capacitor native — not needed on desktop/localhost
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== "visible") return;

      // Only run this recovery logic on Capacitor native where WebView
      // can clear localStorage in the background. On web/localhost this
      // causes race conditions during login.
      const isNative =
        typeof window !== "undefined" &&
        ((window as any).Capacitor !== undefined ||
          (/Android/.test(navigator.userAgent) && /wv/.test(navigator.userAgent)));
      if (!isNative) return;

      // Wait a moment for any in-flight auth state changes to settle
      await new Promise((r) => setTimeout(r, 1000));

      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (!currentSession) {
          // Session gone — try to restore from native storage
          await restoreNativeSession();
          const { data: { session: restored } } = await supabase.auth.getSession();

          if (!restored) {
            // Try refreshing the token
            const { data: { session: refreshed } } = await supabase.auth.refreshSession();

            if (!refreshed) {
              // Truly logged out — clear state
              setUser(null);
              setSupabaseUser(null);
              setSession(null);
              userProfileCache = null;
            }
          }
        }
      } catch (err) {
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      locationTracker.stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Foreground location refresh. The general LocationTracker only runs
  // continuously when the user is on `radius` alert mode or has an active
  // SOS — everyone else's last_latitude/last_longitude would otherwise be
  // a one-shot value captured at last sign-in. Whenever the app becomes
  // visible (and on mount), grab a fresh fix if our last one is >5 min old.
  // Keeps the radius-based notification filter honest without violating
  // the "no always-on background tracking" policy.
  const lastForegroundRefreshRef = useRef(0);
  useEffect(() => {
    if (!user) return;

    // Keep the passive last-known location fresh while the app is open: on
    // mount, when it returns to the foreground, and on a slow periodic tick.
    // Uses the tracker's high-accuracy capture (with address on movement) so
    // the admin user page is accurate — the safety net for locating someone
    // who never got to tap SOS/SML. Throttled so quick tab switches don't spam.
    const REFRESH_THRESHOLD_MS = 60 * 1000;
    const PERIODIC_MS = 90 * 1000;

    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastForegroundRefreshRef.current < REFRESH_THRESHOLD_MS) return;
      lastForegroundRefreshRef.current = now;
      void locationTracker.captureNow(user.id);
    };

    refresh();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Slow periodic refresh while the app stays open (no backgrounding event).
    const periodic = setInterval(refresh, PERIODIC_MS);

    // Capacitor app resume is more reliable than visibilitychange in the
    // native WebView.
    let removeAppListener: (() => void) | undefined;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => { if (isActive) refresh(); })
      )
      .then((handle) => { removeAppListener = () => void handle.remove(); })
      .catch(() => {});

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(periodic);
      removeAppListener?.();
    };
  }, [user]);

  async function checkAndStartLocationTracking(userId: string) {
    try {
      // Passive safety net for EVERY user: grab a fresh, accurate fix the
      // moment the app opens so the admin user page always has a recent
      // last-known location — even if they never trigger SOS/SML. The
      // foreground/periodic refresh effect keeps it current while the app is
      // open; this is the immediate first write.
      await locationTracker.captureNow(userId);

      // Users with a custom radius alert zone or an active SOS additionally
      // need continuous real-time tracking (every ~10s).
      const [{ data: settings }, { data: sos }] = await Promise.all([
        supabase
          .from("user_settings")
          .select("alert_zone_type")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("sos_alerts")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "active")
          .maybeSingle(),
      ]);

      if (settings?.alert_zone_type === "radius" || !!sos) {
        locationTracker.start(userId);
      }
    } catch (error) {
    }
  }

  async function fetchUserProfile(userId: string, force = false) {
    if (!force && userProfileCache && 
        userProfileCache.userId === userId && 
        Date.now() - userProfileCache.timestamp < CACHE_DURATION) {
      setUser(userProfileCache.profile);
      return;
    }

    if (force) {
      userProfileCache = null;
    }

    // If already fetching, wait for it to finish rather than skipping
    if (fetchingRef.current) {
      // Wait up to 5 seconds for the current fetch to complete
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (!fetchingRef.current) break;
      }
      // Non-forced callers may reuse the cache populated by the in-flight fetch
      if (!force && userProfileCache && userProfileCache.userId === userId) {
        setUser(userProfileCache.profile);
        return;
      }
      // Forced refresh must hit the DB — don't return stale cache from before save
      if (!force && fetchingRef.current) return;
    }
    fetchingRef.current = true;

    try {
      let data: any = null;
      let error: any = null;

      // Retry up to 3 times — session token may not be ready on first attempt
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .maybeSingle();

        data = res.data;
        error = res.error;

        if (!error && data) break; // Success
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }

      if (error) {
      }
      // If no profile exists (first-time OAuth user), create one
      if (!data && supabaseUser) {
        console.log("[Auth] No profile found, creating for OAuth user:", supabaseUser.email);
        const meta = supabaseUser.user_metadata || {};
        const newProfile = {
          id: userId,
          email: supabaseUser.email || "",
          full_name: meta.full_name || meta.name || "",
          avatar_url: meta.avatar_url || meta.picture || "",
          phone: meta.phone || "",
          status: "active",
          email_verified: !!supabaseUser.email_confirmed_at,
        };
        const { data: inserted, error: insertErr } = await supabase
          .from("users")
          .upsert(newProfile, { onConflict: "id" })
          .select()
          .single();
        console.log("[Auth] Profile create result:", insertErr ? insertErr.message : "success", inserted?.id);
        if (!insertErr && inserted) {
          data = inserted;
        }
      }
      const profile: User = data ? {
        id: data.id,
        email: data.email,
        phone: data.phone,
        full_name: data.full_name,
        avatar_url: data.avatar_url,
        occupation: data.occupation,
        // The profile-completion gate (lib/profileComplete.ts) reads
        // date_of_birth and home_address — they MUST flow through here or
        // the "Complete your profile" banner never clears after a save.
        date_of_birth: data.date_of_birth,
        home_address: data.home_address,
        gender: data.gender,
        reputation_score: data.reputation_score,
        created_at: data.created_at,
        status: data.status,
        email_verified: data.email_verified || false,
        phone_verified: data.phone_verified || false,
        last_latitude: data.last_latitude,
        last_longitude: data.last_longitude,
        last_location_updated_at: data.last_location_updated_at,
        is_guardian: data.is_guardian || false,
        is_admin: data.is_admin || false,
        is_vip: data.is_vip || false,
        is_mvp: data.is_mvp || false,
      } : {
        id: userId,
        email: supabaseUser?.email || "",
        email_verified: false,
        phone_verified: false,
      };

      setUser(profile);

      if (profile.status === "banned") {
  await supabase.auth.signOut();
  setUser(null);
  setSupabaseUser(null);
  setSession(null);
  if (typeof window !== "undefined") {
    alert("Your account has been banned.");
    window.location.href = "/login";
  }
  return;
}
      
      userProfileCache = {
        userId,
        profile,
        timestamp: Date.now(),
      };
      try {
        localStorage.setItem(PROFILE_LS_KEY, JSON.stringify({ userId, profile, timestamp: Date.now() }));
      } catch {}
    } catch (error) {
      setUser({
        id: userId,
        email: supabaseUser?.email || "",
        email_verified: false,
        phone_verified: false,
      });
    } finally {
      fetchingRef.current = false;
    }
  }

  async function refreshUser() {
    userProfileCache = null;
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      await fetchUserProfile(authUser.id, true);
    }
  }

    const startUserRowSubscription = async (userId: string) => {
    // remove previous subscription only (do NOT remove all channels)
    if (userRowChannelRef.current) {
  supabase.removeChannel(userRowChannelRef.current);
  userRowChannelRef.current = null;
}

    // seed statusRef from current user state (if available)
    statusRef.current = user?.status || statusRef.current;

    const ch = supabase
      .channel(`me-users-row-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "users", filter: `id=eq.${userId}` },
        async (payload) => {
          const next: any = payload.new;
          if (!next?.id) return;

          // update local user immediately
          setUser((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              status: next.status,
              is_guardian: next.is_guardian ?? prev.is_guardian,
              is_admin: next.is_admin ?? prev.is_admin,
              is_vip: next.is_vip ?? prev.is_vip,
              is_mvp: next.is_mvp ?? prev.is_mvp,
            };
          });

          const newStatus = next.status as string | null;
          const oldStatus = statusRef.current;

          if (newStatus && newStatus !== oldStatus) {
            statusRef.current = newStatus;

            if (newStatus === "suspended") {
              setFlashToast("warning", "Your account has been suspended.");
            }

            if (newStatus === "banned") {
              // ✅ immediate kick out + in-app toast on login
              setFlashToast("danger", "Your account has been banned.");

              // sign out + clear state
              await clearNativeSession();
              await supabase.auth.signOut();
              userProfileCache = null;
              locationTracker.stop();

              setUser(null);
              setSupabaseUser(null);
              setSession(null);

              // hard navigate to ensure stacks close
              window.location.assign("/login");
            }
          }
        }
      )
      .subscribe();

    userRowChannelRef.current = ch;
  };


  async function signUp(email: string, password: string, fullName: string, phone: string) {
    signingInRef.current = true;
    try {
      
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { 
            full_name: fullName,
            phone: phone,
          },
        },
      });

      if (authError) {
        return { error: authError };
      }
      
      if (!authData.user) {
        return { error: new Error("Failed to create user") };
      }


      try {
        const { error: updateError } = await supabase
          .from("users")
          .update({ phone: phone })
          .eq("id", authData.user.id);

        if (updateError) {
        } else {
        }
      } catch (updateErr) {
      }

      if (authData.session) {
        setSession(authData.session);
        setSupabaseUser(authData.user);

        // Wait for Supabase client to actually have the session ready
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 150));
          const { data: check } = await supabase.auth.getSession();
          if (check.session?.access_token) break;
        }

        await fetchUserProfile(authData.user.id);
        checkAndStartLocationTracking(authData.user.id);
      }

      return { error: null };
      
    } catch (error: any) {
      return { error: error };
    } finally {
      signingInRef.current = false;
    }
  }

  async function signIn(email: string, password: string) {
    signingInRef.current = true;
    try {
          const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return { error };

    // ✅ Check DB status BEFORE allowing app session state to proceed
    const { data: row, error: stErr } = await supabase
      .from("users")
      .select("status")
      .eq("id", data.user.id)
      .single();

    // If we can't read status, allow login (but you should have RLS allowing self-read)
    const status = row?.status as "active" | "suspended" | "banned" | undefined;

    if (status === "banned") {
      // Immediately sign out and block entry
      await supabase.auth.signOut();

      // show in-app toast (works even on login screen)
      setFlashToast("danger", "Your account has been banned.");

      return { error: new Error("Account banned") };
    }

    // suspended is allowed to login (per your instruction)
    if (data.session) {
      setSession(data.session);
      setSupabaseUser(data.user);

      // Wait for Supabase client to actually have the session ready
      // by polling getSession() until it returns a valid session
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 150));
        const { data: check } = await supabase.auth.getSession();
        if (check.session?.access_token) break;
      }

      await fetchUserProfile(data.user.id);
      checkAndStartLocationTracking(data.user.id);

      if (status === "suspended") {
        setFlashToast("warning", "Your account is suspended. Some features are disabled.");
      }
    }

    return { error: null };
    } catch (error) {
      return { error: error as Error };
    } finally {
      signingInRef.current = false;
    }
  }

   async function signOut() {
    userProfileCache = null;
    locationTracker.stop();
    presenceManager.stop();
    await clearNativeSession();
    await supabase.auth.signOut();
    setUser(null);
    setSupabaseUser(null);
    setSession(null);
  }

  function getBearing(): number {
    return locationTracker.getBearing();
  }

  function getLastPosition(): { lat: number; lng: number } | null {
    return locationTracker.getLastPosition();
  }

  return (
    <AuthContext.Provider
      value={{ 
        user, 
        supabaseUser, 
        session, 
        loading, 
        signUp, 
        signIn, 
        signOut, 
        refreshUser,
        getBearing,
        getLastPosition,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export { locationTracker };