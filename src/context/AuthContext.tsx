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

  is_guardian?: boolean;
  is_admin?: boolean;
  is_vip?: boolean;      

  email_verified: boolean;
  phone_verified: boolean;

  last_latitude?: number;
  last_longitude?: number;

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
    
    console.log("🌍 Starting location tracking...");

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
          console.warn("Compass permission denied:", err);
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
    console.log("🛑 Stopping location tracking");
    
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

  private async savePosition(latitude: number, longitude: number) {
    if (!this.userId) return;

    try {
      const address = await this.getAddressFromCoords(latitude, longitude);

      console.log(`📍 Location updated: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);

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
        console.error("Error saving location:", error);
      }
    } catch (err) {
      console.error("Error in savePosition:", err);
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
        console.warn("📍 Location permission denied");
        break;
      case error.POSITION_UNAVAILABLE:
        console.warn("📍 Location unavailable");
        break;
      case error.TIMEOUT:
        console.warn("📍 Location request timeout");
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
          console.warn("Could not get position:", error.message);
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
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
          await fetchUserProfile(currentSession.user.id);
          checkAndStartLocationTracking(currentSession.user.id);
          presenceManager.start(currentSession.user.id);
          await startUserRowSubscription(currentSession.user.id);
        } else {
          // No cached session — try refreshing (handles expired access tokens)
          const { data: { session: refreshed } } = await supabase.auth.refreshSession();
          if (refreshed?.user) {
            setSession(refreshed);
            setSupabaseUser(refreshed.user);
            await fetchUserProfile(refreshed.user.id);
            checkAndStartLocationTracking(refreshed.user.id);
            presenceManager.start(refreshed.user.id);
            await startUserRowSubscription(refreshed.user.id);
          }
        }
      } catch (error) {
        console.error("Auth init error:", error);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(() => {
      setLoading(false);
    }, 5000);

    initAuth().finally(() => {
      clearTimeout(timeoutId);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        console.log("Auth event:", event);

        if (event === 'TOKEN_REFRESHED') {
          setSession(newSession);
          return;
        }

        setSession(newSession);

        if (newSession?.user) {
          setSupabaseUser(newSession.user);
          
          // Skip profile fetch if signIn/signUp is already handling it
          // This prevents race conditions with fetchingRef and RLS timing
          if (!signingInRef.current) {
            fetchUserProfile(newSession.user.id).catch(() => {});
          }
          startUserRowSubscription(newSession.user.id).catch(() => {});
          
            if (event === 'SIGNED_IN') {
            checkAndStartLocationTracking(newSession.user.id);
            presenceManager.start(newSession.user.id);
          }
        } else {
          // Only clear user state on explicit SIGNED_OUT event.
          // Other events (INITIAL_SESSION, TOKEN_REFRESHED) may briefly
          // have null session during transitions — don't wipe state for those.
          if (event === 'SIGNED_OUT') {
            setUser(null);
            setSupabaseUser(null);
            setSession(null);
            userProfileCache = null;
            locationTracker.stop();
            presenceManager.stop();
          } else {
            console.log(`[Auth] Ignoring null session for event: ${event}`);
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
              console.log("[Auth] Session lost on resume, clearing state");
              setUser(null);
              setSupabaseUser(null);
              setSession(null);
              userProfileCache = null;
            }
          }
        }
      } catch (err) {
        console.warn("[Auth] Visibility change session check failed:", err);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      locationTracker.stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  async function checkAndStartLocationTracking(userId: string) {
    try {
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

      const hasCustomRadius = settings?.alert_zone_type === "radius";
      const hasActiveSOS = !!sos;

      console.log("🌍 User needs location tracking:", { hasCustomRadius, hasActiveSOS });

      if (hasCustomRadius || hasActiveSOS) {
        locationTracker.start(userId);
      } else {
        const position = await locationTracker.getCurrentPosition();
        if (position && userId) {
          await supabase
            .from("users")
            .update({
              last_latitude: position.lat,
              last_longitude: position.lng,
              last_location_updated_at: new Date().toISOString(),
            })
            .eq("id", userId);
        }
      }
    } catch (error) {
      console.error("Error checking location tracking:", error);
    }
  }

  async function fetchUserProfile(userId: string, force = false) {
    if (!force && userProfileCache && 
        userProfileCache.userId === userId && 
        Date.now() - userProfileCache.timestamp < CACHE_DURATION) {
      setUser(userProfileCache.profile);
      return;
    }

    // If already fetching, wait for it to finish rather than skipping
    if (fetchingRef.current) {
      // Wait up to 5 seconds for the current fetch to complete
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (!fetchingRef.current) break;
      }
      // If cache was populated by the other fetch, use it
      if (userProfileCache && userProfileCache.userId === userId) {
        setUser(userProfileCache.profile);
        return;
      }
      // If still fetching after 5s, proceed anyway
      if (fetchingRef.current) return;
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
          console.log(`[Auth] Profile fetch attempt ${attempt + 1} failed, retrying...`);
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }

      if (error) {
        console.error("Profile fetch error:", {
          message: (error as any)?.message,
          details: (error as any)?.details,
          hint: (error as any)?.hint,
          code: (error as any)?.code,
        });
      }

      const profile: User = data ? {
        id: data.id,
        email: data.email,
        phone: data.phone,
        full_name: data.full_name,
        avatar_url: data.avatar_url,
        occupation: data.occupation,
        status: data.status,
        email_verified: data.email_verified || false,
        phone_verified: data.phone_verified || false,
        last_latitude: data.last_latitude,
        last_longitude: data.last_longitude,
        is_guardian: data.is_guardian || false,
        is_admin: data.is_admin || false,
        is_vip: data.is_vip || false,
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
    } catch (error) {
      console.error("Profile error:", error);
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
      await fetchUserProfile(authUser.id);
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
      console.log("🔐 Starting signup process...");
      
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
        console.error("❌ Auth signup error:", authError);
        return { error: authError };
      }
      
      if (!authData.user) {
        return { error: new Error("Failed to create user") };
      }

      console.log("✅ Auth user created:", authData.user.id);

      try {
        const { error: updateError } = await supabase
          .from("users")
          .update({ phone: phone })
          .eq("id", authData.user.id);

        if (updateError) {
          console.warn("⚠️ Phone update error:", updateError);
        } else {
          console.log("✅ Phone number updated");
        }
      } catch (updateErr) {
        console.warn("⚠️ Phone update exception:", updateErr);
      }

      if (authData.session) {
        setSession(authData.session);
        setSupabaseUser(authData.user);

        // Wait for Supabase client to internalize the new session token
        await new Promise((r) => setTimeout(r, 300));

        await fetchUserProfile(authData.user.id, true);
        checkAndStartLocationTracking(authData.user.id);
      }

      console.log("✅ Signup complete!");
      return { error: null };
      
    } catch (error: any) {
      console.error("❌ Signup exception:", error);
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

      // Wait for Supabase client to internalize the new session token
      // before making authenticated queries (prevents RLS empty errors)
      await new Promise((r) => setTimeout(r, 300));

      await fetchUserProfile(data.user.id, true);
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