"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { LogIn, UserPlus } from "lucide-react";

const PUBLIC_PATHS = ["/login", "/signup", "/terms", "/privacy", "/help", "/offline.html"];
const DISMISSED_KEY = "peja-login-prompt-dismissed";

export function LoginPrompt() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (user) return;
    if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return;

    // Check if already dismissed this session
    const dismissed = sessionStorage.getItem(DISMISSED_KEY);
    if (dismissed) return;

    // Show after a short delay
    const timer = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(timer);
  }, [user, loading, pathname]);

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, "true");
    setShow(false);
  };

  if (!show) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[30000] bg-black/70 backdrop-blur-sm"
        onClick={handleDismiss}
        style={{ animation: "fadeIn 0.3s ease" }}
      />
      <div className="fixed inset-0 z-[30001] flex items-center justify-center p-6">
        <div
          className="w-full max-w-sm rounded-3xl overflow-hidden animate-bounce-in"
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
                setShow(false);
                router.push("/signup");
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
                setShow(false);
                router.push("/login");
              }}
              className="w-full py-3 rounded-xl text-sm font-medium text-primary-400 transition-colors hover:bg-white/5 active:bg-white/10 flex items-center justify-center gap-2"
              style={{
                border: "1px solid rgba(139, 92, 246, 0.2)",
              }}
            >
              <LogIn className="w-4 h-4" />
              Already have an account? Log In
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