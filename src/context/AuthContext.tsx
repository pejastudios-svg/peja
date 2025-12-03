"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    const initAuth = async () => {
      try {
        const { data: { session: currentSession }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error("Session error:", error);
          setLoading(false);
          return;
        }

        if (currentSession?.user) {
          setSession(currentSession);
          setSupabaseUser(currentSession.user);
          await fetchUserProfile(currentSession.user.id);
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error("Auth init error:", error);
        setLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        console.log("Auth event:", event);
        
        setSession(newSession);
        
        if (newSession?.user) {
          setSupabaseUser(newSession.user);
          await fetchUserProfile(newSession.user.id);
        } else {
          setUser(null);
          setSupabaseUser(null);
          setLoading(false);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function fetchUserProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.error("Profile fetch error:", error);
      }

      if (data) {
        setUser({
          id: data.id,
          email: data.email,
          phone: data.phone,
          full_name: data.full_name,
          avatar_url: data.avatar_url,
          occupation: data.occupation,
          email_verified: data.email_verified || false,
          phone_verified: data.phone_verified || false,
        });
      } else {
        // User in auth but not in users table - create basic profile
        const { data: authUser } = await supabase.auth.getUser();
        if (authUser?.user) {
          setUser({
            id: authUser.user.id,
            email: authUser.user.email || "",
            email_verified: !!authUser.user.email_confirmed_at,
            phone_verified: false,
          });
        }
      }
    } catch (error) {
      console.error("Profile error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function refreshUser() {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      await fetchUserProfile(authUser.id);
    }
  }

  async function signUp(email: string, password: string, fullName: string, phone: string) {
    try {
      // 1. Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (authError) {
        console.error("Signup auth error:", authError);
        return { error: authError };
      }

      if (!authData.user) {
        return { error: new Error("Failed to create user") };
      }

      // 2. Create user profile in database
      const { error: profileError } = await supabase.from("users").insert({
        id: authData.user.id,
        email: email,
        phone: phone,
        full_name: fullName,
        email_verified: false,
        phone_verified: false,
        status: "active",
        reputation_score: 0,
        is_guardian: false,
      });

      if (profileError) {
        console.error("Profile creation error:", profileError);
        // Don't return error - user was created in auth
      }

      // 3. Auto sign in
      if (authData.session) {
        setSession(authData.session);
        setSupabaseUser(authData.user);
        await fetchUserProfile(authData.user.id);
      }

      return { error: null };
    } catch (error) {
      console.error("Signup error:", error);
      return { error: error as Error };
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { error };
      }

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