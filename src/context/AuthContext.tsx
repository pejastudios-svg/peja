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

// Cache for user profile
let userProfileCache: { userId: string; profile: User; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Update user location in background
async function updateUserLocationInBackground(userId: string) {
  try {
    if (!navigator.geolocation) {
      console.log("Geolocation not supported");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        
        // Get address from coordinates
        let address = "Unknown location";
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
            { headers: { "User-Agent": "Peja App" } }
          );
          const data = await response.json();
          if (data?.address) {
            const addr = data.address;
            const parts = [];
            if (addr.road) parts.push(addr.road);
            if (addr.neighbourhood) parts.push(addr.neighbourhood);
            if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village);
            if (addr.state) parts.push(addr.state);
            address = parts.length > 0 ? parts.join(", ") : "Location found";
          }
        } catch (e) {
          console.log("Could not get address");
        }

        // Update user location in database
        await supabase
          .from("users")
          .update({
            last_latitude: latitude,
            last_longitude: longitude,
            last_address: address,
            last_location_updated_at: new Date().toISOString(),
          })
          .eq("id", userId);

        console.log("User location updated:", latitude, longitude, address);
      },
      (error) => {
        console.log("Could not get location:", error.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  } catch (error) {
    console.error("Error updating location:", error);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const initRef = useRef(false);
  const fetchingRef = useRef(false);
  const locationUpdateRef = useRef(false);

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
          
          // Update location in background (only once per session)
          if (!locationUpdateRef.current) {
            locationUpdateRef.current = true;
            updateUserLocationInBackground(currentSession.user.id);
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
          fetchUserProfile(newSession.user.id).catch(() => {});
          
          // Update location on sign in
          if (event === 'SIGNED_IN' && !locationUpdateRef.current) {
            locationUpdateRef.current = true;
            updateUserLocationInBackground(newSession.user.id);
          }
        } else {
          setUser(null);
          setSupabaseUser(null);
          userProfileCache = null;
          locationUpdateRef.current = false;
        }
      }
    );

    // Update location every 5 minutes while app is open
    const locationInterval = setInterval(() => {
      if (user?.id) {
        updateUserLocationInBackground(user.id);
      }
    }, 5 * 60 * 1000);

    return () => {
      subscription.unsubscribe();
      clearInterval(locationInterval);
    };
  }, []);

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
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      if (authError) return { error: authError };
      if (!authData.user) return { error: new Error("Failed to create user") };

      try {
        await supabase.from("users").insert({
          id: authData.user.id,
          email,
          phone,
          full_name: fullName,
          email_verified: false,
          phone_verified: false,
          status: "active",
          reputation_score: 0,
          is_guardian: false,
        });
      } catch (profileError) {
        console.error("Profile creation error:", profileError);
      }

      if (authData.session) {
        setSession(authData.session);
        setSupabaseUser(authData.user);
        await fetchUserProfile(authData.user.id);
        
        // Update location after signup
        updateUserLocationInBackground(authData.user.id);
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
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
        
        // Update location after login
        locationUpdateRef.current = true;
        updateUserLocationInBackground(data.user.id);
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  async function signOut() {
    userProfileCache = null;
    locationUpdateRef.current = false;
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