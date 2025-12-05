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

// Simple in-memory cache for user profile
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
    // Prevent double initialization in strict mode
    if (initRef.current) return;
    initRef.current = true;

    const initAuth = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (currentSession?.user) {
          setSession(currentSession);
          setSupabaseUser(currentSession.user);
          await fetchUserProfile(currentSession.user.id);
        }
      } catch (error) {
        console.error("Auth init error:", error);
      } finally {
        // ALWAYS set loading to false, no matter what
        setLoading(false);
      }
    };

    // Set a timeout to ensure loading NEVER stays true forever
    const timeoutId = setTimeout(() => {
      setLoading(false);
    }, 5000); // Max 5 seconds to initialize

    initAuth().finally(() => {
      clearTimeout(timeoutId);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        console.log("Auth event:", event);

        // Ignore token refresh events - they don't need full reload
        if (event === 'TOKEN_REFRESHED') {
          setSession(newSession);
          return;
        }

        setSession(newSession);

        if (newSession?.user) {
          setSupabaseUser(newSession.user);
          // Don't block on profile fetch during navigation
          fetchUserProfile(newSession.user.id).catch(() => {});
        } else {
          setUser(null);
          setSupabaseUser(null);
          userProfileCache = null;
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function fetchUserProfile(userId: string) {
    // Check cache first
    if (userProfileCache && 
        userProfileCache.userId === userId && 
        Date.now() - userProfileCache.timestamp < CACHE_DURATION) {
      setUser(userProfileCache.profile);
      return;
    }

    // Prevent concurrent fetches
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
        // Don't return - still set basic user info
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
      
      // Cache the profile
      userProfileCache = {
        userId,
        profile,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("Profile error:", error);
      // Set minimal user info on error
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
    userProfileCache = null; // Clear cache
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

      // Create profile - don't fail signup if this fails
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
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  async function signOut() {
    userProfileCache = null;
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