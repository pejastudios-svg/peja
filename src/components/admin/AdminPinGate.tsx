"use client";

import { useState, useEffect, useRef } from "react";
import { Lock, Eye, EyeOff, ShieldAlert } from "lucide-react";

const ADMIN_PIN = process.env.NEXT_PUBLIC_ADMIN_PIN || "";
const SESSION_KEY = "peja-admin-unlocked";

export default function AdminPinGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check if already unlocked this session
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored === "true") {
      setUnlocked(true);
    }

    // Check lockout
    const lockout = sessionStorage.getItem("peja-admin-lockout");
    if (lockout) {
      const until = parseInt(lockout);
      if (Date.now() < until) {
        setLockedUntil(until);
      } else {
        sessionStorage.removeItem("peja-admin-lockout");
      }
    }
  }, []);

  // Countdown timer for lockout
  useEffect(() => {
    if (!lockedUntil) return;
    const interval = setInterval(() => {
      if (Date.now() >= lockedUntil) {
        setLockedUntil(null);
        setAttempts(0);
        sessionStorage.removeItem("peja-admin-lockout");
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  useEffect(() => {
    if (!unlocked) inputRef.current?.focus();
  }, [unlocked]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (lockedUntil && Date.now() < lockedUntil) {
      return;
    }

    if (!ADMIN_PIN) {
      setError("Admin PIN not configured");
      return;
    }

    if (pin === ADMIN_PIN) {
      sessionStorage.setItem(SESSION_KEY, "true");
      setUnlocked(true);
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setPin("");
      
      if (newAttempts >= 5) {
        // Lock for 5 minutes after 5 failed attempts
        const lockoutTime = Date.now() + 5 * 60 * 1000;
        setLockedUntil(lockoutTime);
        sessionStorage.setItem("peja-admin-lockout", lockoutTime.toString());
        setError("Too many attempts. Locked for 5 minutes.");
      } else {
        setError(`Incorrect PIN. ${5 - newAttempts} attempts remaining.`);
      }
    }
  };

  if (unlocked) return <>{children}</>;

  const remainingSeconds = lockedUntil 
    ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000))
    : 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8 text-primary-400" />
          </div>
          <h1 className="text-2xl font-bold text-dark-50">Admin Access</h1>
          <p className="text-sm text-dark-400 mt-2">Enter your admin PIN to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
            <input
              ref={inputRef}
              type={showPin ? "text" : "password"}
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError(""); }}
              placeholder="Enter PIN"
              className="w-full pl-12 pr-12 py-4 glass-input text-lg tracking-[0.3em] text-center font-mono"
              disabled={!!lockedUntil && Date.now() < lockedUntil}
              autoComplete="off"
              inputMode="numeric"
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1"
            >
              {showPin 
                ? <EyeOff className="w-5 h-5 text-dark-500" /> 
                : <Eye className="w-5 h-5 text-dark-500" />
              }
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}

          {lockedUntil && Date.now() < lockedUntil && (
            <p className="text-sm text-red-400 text-center">
              Locked. Try again in {Math.floor(remainingSeconds / 60)}:{(remainingSeconds % 60).toString().padStart(2, "0")}
            </p>
          )}

          <button
            type="submit"
            disabled={!pin || (!!lockedUntil && Date.now() < lockedUntil)}
            className="w-full py-4 bg-primary-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-primary-500 transition-colors"
          >
            Unlock Dashboard
          </button>
        </form>

        <p className="text-xs text-dark-600 text-center mt-6">
          Session expires when you close this tab
        </p>
      </div>
    </div>
  );
}