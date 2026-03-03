// src/components/admin/AdminPinGate.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Lock, Eye, EyeOff, ShieldAlert, AlertTriangle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes

export default function AdminPinGate({ children }: { children: React.ReactNode }) {
  const { session, user } = useAuth();
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── check existing session cookie on mount ───
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/check-session", { credentials: "include" });
        const d = await r.json();
        if (d.valid) setUnlocked(true);
      } catch {}
      setChecking(false);
    })();
  }, []);

  // ─── auto-lock on inactivity ───
  useEffect(() => {
    if (!unlocked) return;

    const resetTimer = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      inactivityTimer.current = setTimeout(async () => {
        setUnlocked(false);
        setPin("");
        try {
          await fetch("/api/admin/logout-session", {
            method: "POST",
            credentials: "include",
          });
        } catch {}
      }, INACTIVITY_TIMEOUT);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart", "mousemove"];
    events.forEach((e) => document.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      events.forEach((e) => document.removeEventListener(e, resetTimer));
    };
  }, [unlocked]);

  // ─── lockout countdown ───
  useEffect(() => {
    if (!lockedUntil) return;
    const iv = setInterval(() => {
      if (Date.now() >= lockedUntil) {
        setLockedUntil(null);
        setAttemptsRemaining(5);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [lockedUntil]);

  // ─── focus input ───
  useEffect(() => {
    if (!unlocked && !checking) inputRef.current?.focus();
  }, [unlocked, checking]);

  // ─── 📸 silent webcam capture ───
  const capturePhoto = useCallback(async (): Promise<string | null> => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return null;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 600)); // let camera stabilise

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext("2d")?.drawImage(video, 0, 0);

      stream.getTracks().forEach((t) => t.stop());
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return null; // camera denied / unavailable — still send alert without photo
    }
  }, []);

  // ─── send intruder alert (fire-and-forget) ───
  const sendIntruderAlert = useCallback(
    async (photo: string | null) => {
      try {
        await fetch("/api/admin/intruder-alert", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token || ""}`,
          },
          body: JSON.stringify({
            photo,
            userId: user?.id,
            userEmail: user?.email,
            userName: user?.full_name,
          }),
        });
      } catch {
        // silent — never reveal to intruder
      }
    },
    [session, user]
  );

  // ─── submit PIN ───
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim() || loading) return;
    if (lockedUntil && Date.now() < lockedUntil) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/verify-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        credentials: "include",
        body: JSON.stringify({ pin: pin.trim() }),
      });

      const data = await res.json();

      if (data.ok) {
        setUnlocked(true);
        return;
      }

      // ── failed ──
      setPin("");

      if (data.locked) {
        setLockedUntil(Date.now() + (data.lockout_minutes || 5) * 60_000);
        setError(`Locked for ${data.lockout_minutes} minutes.`);
      } else {
        setAttemptsRemaining(data.attempts_remaining ?? 4);
        setError(data.error || "Incorrect PIN");
      }

      // 📸 capture + alert (async, non-blocking)
      capturePhoto().then((photo) => sendIntruderAlert(photo));
    } catch {
      setError("Connection error — try again.");
    } finally {
      setLoading(false);
    }
  };

  // ─── loading state ───
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (unlocked) return <>{children}</>;

  // ─── PIN gate UI ───
  const remaining = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;

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
              disabled={loading || (!!lockedUntil && Date.now() < lockedUntil)}
              autoComplete="off"
              inputMode="numeric"
            />
            <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-4 top-1/2 -translate-y-1/2 p-1">
              {showPin ? <EyeOff className="w-5 h-5 text-dark-500" /> : <Eye className="w-5 h-5 text-dark-500" />}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 justify-center">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {lockedUntil && Date.now() < lockedUntil && (
            <p className="text-sm text-red-400 text-center">
              Try again in {Math.floor(remaining / 60)}:{(remaining % 60).toString().padStart(2, "0")}
            </p>
          )}

          {!lockedUntil && attemptsRemaining < 5 && (
            <p className="text-xs text-dark-500 text-center">{attemptsRemaining} attempts remaining</p>
          )}

          <button
            type="submit"
            disabled={!pin || loading || (!!lockedUntil && Date.now() < lockedUntil)}
            className="w-full py-4 bg-primary-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-primary-500 transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Verifying…</>
            ) : (
              "Unlock Dashboard"
            )}
          </button>
        </form>

        <p className="text-xs text-dark-600 text-center mt-6">
          🔒 All attempts are monitored, logged, and photographed
        </p>
      </div>
    </div>
  );
}