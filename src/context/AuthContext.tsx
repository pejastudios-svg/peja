"use client";

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { User as SupabaseUser, Session } from "@supabase/supabase-js";

interface User {
  id: string;
  email: string;
  phone?: string;
  full_name?: string;
  avatar_url?: string;
  occupation?: string;
  email_verified: boolean;
  phone_verified: boolean;
  last_latitude?: number;
  last_longitude?: number;
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// =====================================================
// LOCATION TRACKING SERVICE
// =====================================================
class LocationTracker {
  private watchId: number | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private lastPosition: { lat: number; lng: number } | null = null;
  private userId: string | null = null;
  private isTracking = false;

  // Start tracking location every 10 seconds
  start(userId: string) {
    if (this.isTracking) return;
    
    this.userId = userId;
    this.isTracking = true;
    
    console.log("🌍 Starting location tracking...");

    // Use watchPosition for continuous updates
    if (navigator.geolocation) {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.handlePositionUpdate(position),
        (error) => this.handleError(error),
        {
          enableHighAccuracy: true,
          maximumAge: 10000, // Accept positions up to 10 seconds old
          timeout: 15000,
        }
      );

      // Also set interval to force updates every 10 seconds
      this.updateInterval = setInterval(() => {
        this.forceUpdate();
      }, 10000);
    }
  }

  // Stop tracking
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

  // Handle position update
  private async handlePositionUpdate(position: GeolocationPosition) {
    const { latitude, longitude } = position.coords;

    // Only update if position changed significantly (more than 10 meters)
    if (this.lastPosition) {
      const distance = this.calculateDistance(
        this.lastPosition.lat,
        this.lastPosition.lng,
        latitude,
        longitude
      );

      if (distance < 0.01) {
        // Less than 10 meters, skip update
        return;
      }
    }

    this.lastPosition = { lat: latitude, lng: longitude };
    await this.savePosition(latitude, longitude);
  }

  // Force an update
  private forceUpdate() {
    navigator.geolocation.getCurrentPosition(
      (position) => this.handlePositionUpdate(position),
      (error) => this.handleError(error),
      {
        enableHighAccuracy: true,
        timeout: 10000,
      }
    );
  }

  // Save position to database
  private async savePosition(latitude: number, longitude: number) {
    if (!this.userId) return;

    try {
      // Get address from coordinates
      const address = await this.getAddressFromCoords(latitude, longitude);

      console.log(`📍 Location updated: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);

      // Update user's location in database
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

  // Get address from coordinates using OpenStreetMap
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

  // Calculate distance between two points in kilometers
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

  // Handle geolocation errors
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

  // Get current position once (for initial load)
  async getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => resolve(null),
        {
          enableHighAccuracy: true,
          timeout: 10000,
        }
      );
    });
  }
}

// Create singleton instance
const locationTracker = new LocationTracker();

// Cache for user profile
let userProfileCache: { userId: string; profile: User; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const initRef = useRef(false);
  const fetchingRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const initAuth = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (currentSession?.user) {
          setSession(currentSession);
          setSupabaseUser(currentSession.user);
          await fetchUserProfile(currentSession.user.id);
          
          // Check if user needs location tracking
          checkAndStartLocationTracking(currentSession.user.id);
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
          fetchUserProfile(newSession.user.id).catch(() => {});
          
          if (event === 'SIGNED_IN') {
            checkAndStartLocationTracking(newSession.user.id);
          }
        } else {
          setUser(null);
          setSupabaseUser(null);
          userProfileCache = null;
          locationTracker.stop();
        }
      }
    );

    // Cleanup on unmount
    return () => {
      subscription.unsubscribe();
      locationTracker.stop();
    };
  }, []);

  // Check if user needs location tracking based on settings
  async function checkAndStartLocationTracking(userId: string) {
    try {
      // Check if user has custom radius or active SOS
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

      if (hasCustomRadius || hasActiveSOS) {
        console.log("🌍 User needs location tracking:", { hasCustomRadius, hasActiveSOS });
        locationTracker.start(userId);
      } else {
        // Just get location once and save it
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

  async function fetchUserProfile(userId: string) {
    if (userProfileCache && 
        userProfileCache.userId === userId && 
        Date.now() - userProfileCache.timestamp < CACHE_DURATION) {
      setUser(userProfileCache.profile);
      return;
    }

    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.error("Profile fetch error:", error);
      }

      const profile: User = data ? {
        id: data.id,
        email: data.email,
        phone: data.phone,
        full_name: data.full_name,
        avatar_url: data.avatar_url,
        occupation: data.occupation,
        email_verified: data.email_verified || false,
        phone_verified: data.phone_verified || false,
        last_latitude: data.last_latitude,
        last_longitude: data.last_longitude,
      } : {
        id: userId,
        email: supabaseUser?.email || "",
        email_verified: false,
        phone_verified: false,
      };

      setUser(profile);
      
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

  async function signUp(email: string, password: string, fullName: string, phone: string) {
  try {
    console.log("🔐 Starting signup process...");
    
    // Supabase auth.signUp will trigger handle_new_user which creates:
    // 1. public.users row
    // 2. user_settings row with defaults
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

    // Update the phone number (trigger can't access it from metadata)
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

    // Sign in the user
    if (authData.session) {
      setSession(authData.session);
      setSupabaseUser(authData.user);
      await fetchUserProfile(authData.user.id);
      checkAndStartLocationTracking(authData.user.id);
    }

    console.log("✅ Signup complete!");
    return { error: null };
    
  } catch (error: any) {
    console.error("❌ Signup exception:", error);
    return { error: error };
  }
}

  async function signIn(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) return { error };

      if (data.session) {
        setSession(data.session);
        setSupabaseUser(data.user);
        await fetchUserProfile(data.user.id);
        checkAndStartLocationTracking(data.user.id);
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  async function signOut() {
    userProfileCache = null;
    locationTracker.stop();
    await supabase.auth.signOut();
    setUser(null);
    setSupabaseUser(null);
    setSession(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, supabaseUser, session, loading, signUp, signIn, signOut, refreshUser }}
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

// Export location tracker for use in SOS component
export { locationTracker };