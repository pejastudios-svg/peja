"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { LogIn, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";

const PUBLIC_PATHS = ["/login", "/signup", "/terms", "/privacy", "/help", "/offline.html"];
const DISMISSED_KEY = "peja-login-prompt-dismissed";

export function LoginPrompt() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setShow(false);
      setClosing(false);
    }, 250);
  }, []);

const authCheckedRef = useRef(false);
  useEffect(() => {
    // Wait for auth to finish loading
    if (loading) return;
    // Only check once
    if (authCheckedRef.current) return;
    authCheckedRef.current = true;
    // User is logged in, no need to show
    if (user) return;
    // On a public path, don't show
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return;
    // Already dismissed this session
    const dismissed = sessionStorage.getItem(DISMISSED_KEY);
    if (dismissed) return;
    // Wait for the page to fully render before showing
    const timer = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(timer);
  }, [user, loading, pathname]);

const handleGoogleSignIn = async () => {
    try {
      // Mark that we're doing OAuth so the prompt doesn't show again on redirect
      sessionStorage.setItem(DISMISSED_KEY, "true");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: "https://peja.life",
        },
      });
      if (error) console.error("Google sign-in error:", error);
    } catch {}
  };

   const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, "true");
    handleClose();
  };

  useScrollFreeze(show);
  // Hide prompt when user logs in (e.g., after OAuth redirect)
  useEffect(() => {
    if (user && show) {
      setShow(false);
      return;
    }
    // Also check Supabase session directly (covers OAuth redirect case)
    if (show && !user && !loading) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session?.user) {
          setShow(false);
        }
      });
    }
  }, [user, show, loading]);
  if (!show) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[30000] bg-black/70 backdrop-blur-sm"
        onClick={handleDismiss}
        style={{
          animation: closing ? "fadeOut 0.25s ease forwards" : "fadeIn 0.3s ease",
        }}
      />
      <div className="fixed inset-0 z-[30001] flex items-center justify-center p-6">
        <div
          className={`w-full max-w-sm rounded-3xl overflow-hidden ${closing ? "animate-bounce-out" : "animate-bounce-in"}`}
          style={{
            background: "rgba(18, 12, 36, 0.98)",
            border: "1px solid rgba(139, 92, 246, 0.2)",
            boxShadow:
              "0 0 80px rgba(139, 92, 246, 0.08), 0 25px 60px rgba(0,0,0,0.6)",
          }}
        >
          {/* Header illustration */}
          <div
            className="relative h-36 flex items-center justify-center overflow-hidden"
            style={{
              background:
                "linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(139,92,246,0.1) 50%, rgba(59,130,246,0.1) 100%)",
            }}
          >
            <div className="absolute inset-0 opacity-30">
              <div className="absolute top-4 left-8 w-20 h-20 rounded-full bg-primary-500/20 blur-2xl" />
              <div className="absolute bottom-4 right-8 w-24 h-24 rounded-full bg-blue-500/15 blur-2xl" />
            </div>
            <div className="relative flex flex-col items-center">
             <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2"
                style={{
                  background: "rgba(124, 58, 237, 0.2)",
                  border: "2px solid rgba(139, 92, 246, 0.3)",
                  boxShadow: "0 0 30px rgba(139, 92, 246, 0.2)",
                }}
              >
                <img
                  src="https://plastic-lime-elzghqehop.edgeone.app/peja%20logo%20SINGLE.png"
                  alt="Peja"
                  className="w-10 h-10 object-contain"
                  style={{ filter: "drop-shadow(0 0 4px rgba(167, 139, 250, 0.3))" }}
                />
              </div>
              <span
                className="text-xl font-black tracking-[0.2em]"
                style={{ color: "#a78bfa" }}
              >
                PEJA
              </span>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 text-center">
            <h2 className="text-lg font-bold text-white mb-2">
              Join Your Community
            </h2>
            <p className="text-sm text-dark-400 leading-relaxed mb-6">
              Sign up to report incidents, receive safety alerts, and help keep
              your community safe.
            </p>

            <button
              onClick={() => {
                handleClose();
                setTimeout(() => router.push("/signup"), 300);
              }}
              className="w-full py-3.5 rounded-xl font-semibold text-white transition-all active:scale-[0.98] mb-3 flex items-center justify-center gap-2"
              style={{
                background:
                  "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                boxShadow: "0 4px 20px rgba(124, 58, 237, 0.4)",
              }}
            >
              <UserPlus className="w-5 h-5" />
              Sign Up
            </button>

            <button
                onClick={() => {
                handleClose();
                setTimeout(() => router.push("/login"), 300);
              }}
              className="w-full py-3 rounded-xl text-sm font-medium text-primary-400 transition-colors hover:bg-white/5 active:bg-white/10 flex items-center justify-center gap-2"
              style={{
                border: "1px solid rgba(139, 92, 246, 0.2)",
              }}
            >
              <LogIn className="w-4 h-4" />
              Already have an account? Log In
            </button>

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-dark-500">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <button
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 py-3 rounded-xl font-medium text-white transition-all active:scale-[0.98] hover:bg-white/10"
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>

            <button
              onClick={handleDismiss}
              className="w-full py-3 mt-2 text-sm text-dark-500 hover:text-dark-300 transition-colors"
            >
              Browse as guest
            </button>
          </div>
        </div>
      </div>
    </>
  );
}