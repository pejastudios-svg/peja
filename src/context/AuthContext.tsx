"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { User as SupabaseUser } from "@supabase/supabase-js";

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
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
  // Safety timeout - ensure loading stops after 10 seconds max
  const timeout = setTimeout(() => {
    if (loading) {
      console.warn("Auth loading timeout - forcing complete");
      setLoading(false);
    }
  }, 10000);

  // Check current session
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) {
      setSupabaseUser(session.user);
      fetchUserProfile(session.user.id);
    } else {
      setLoading(false);
    }
  });

  // Listen for auth changes
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (event, session) => {
      console.log("Auth event:", event);
      if (session?.user) {
        setSupabaseUser(session.user);
        await fetchUserProfile(session.user.id);
      } else {
        setUser(null);
        setSupabaseUser(null);
        setLoading(false);
      }
    }
  );

  return () => {
    clearTimeout(timeout);
    subscription.unsubscribe();
  };
}, []);

  async function fetchUserProfile(userId: string) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Error fetching profile:", error);
      // Still set loading to false even on error
      setLoading(false);
      return;
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
      // User exists in auth but not in users table
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        setUser({
          id: authUser.id,
          email: authUser.email || "",
          email_verified: authUser.email_confirmed_at ? true : false,
          phone_verified: false,
        });
      }
    }
  } catch (error) {
    console.error("Error fetching profile:", error);
  } finally {
    // ALWAYS set loading to false
    setLoading(false);
  }
}

  async function signUp(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        return { error };
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

      if (error) {
        return { error };
      }

      if (data.user) {
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
  }

  async function updateProfile(data: Partial<User>) {
    if (!user) {
      return { error: new Error("No user logged in") };
    }

    try {
      const { error } = await supabase
        .from("users")
        .update(data)
        .eq("id", user.id);

      if (error) {
        return { error };
      }

      setUser({ ...user, ...data });
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, supabaseUser, loading, signUp, signIn, signOut, updateProfile }}
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