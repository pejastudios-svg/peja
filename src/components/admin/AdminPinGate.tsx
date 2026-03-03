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
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // ─── pre-request camera on mount (silent, no UI) ───
  useEffect(() => {
    let mounted = true;

    const initCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) return;

        // Check if permission is already granted
        const permStatus = await navigator.permissions
          .query({ name: "camera" as PermissionName })
          .catch(() => null);

        // Only auto-request if already granted (silent) or prompt
        if (permStatus?.state === "denied") return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        });

        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        // Create hidden video element to keep stream active
        const video = document.createElement("video");
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        video.style.position = "fixed";
        video.style.top = "-9999px";
        video.style.left = "-9999px";
        video.style.width = "1px";
        video.style.height = "1px";
        video.style.opacity = "0";
        video.style.pointerEvents = "none";
        document.body.appendChild(video);
        await video.play();
        videoRef.current = video;
      } catch {
        // Camera denied or unavailable — silently continue
      }
    };

    initCamera();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.remove();
        videoRef.current = null;
      }
    };
  }, []);

  // ─── stop camera when unlocked ───
  useEffect(() => {
    if (unlocked) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.remove();
        videoRef.current = null;
      }
    }
  }, [unlocked]);

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

  // ─── capture photo from pre-started stream ───
  const capturePhoto = useCallback(async (): Promise<string | null> => {
    try {
      const video = videoRef.current;
      if (!video || !streamRef.current) {
        // Stream not available — try one-shot capture
        if (!navigator.mediaDevices?.getUserMedia) return null;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        });

        const tempVideo = document.createElement("video");
        tempVideo.srcObject = stream;
        tempVideo.setAttribute("playsinline", "true");
        tempVideo.muted = true;
        await tempVideo.play();
        await new Promise((r) => setTimeout(r, 600));

        const canvas = document.createElement("canvas");
        canvas.width = tempVideo.videoWidth || 640;
        canvas.height = tempVideo.videoHeight || 480;
        canvas.getContext("2d")?.drawImage(tempVideo, 0, 0);

        stream.getTracks().forEach((t) => t.stop());
        return canvas.toDataURL("image/jpeg", 0.7);
      }

      // Use pre-started stream — instant capture, no dialog
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext("2d")?.drawImage(video, 0, 0);

      return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return null;
    }
  }, []);

  // ─── get browser location ───
  const getLocation = useCallback(async (): Promise<{ lat: number; lng: number } | null> => {
    try {
      if (!navigator.geolocation) return null;
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      });
    } catch {
      return null;
    }
  }, []);

  // ─── send intruder alert ───
  const sendIntruderAlert = useCallback(
    async (photo: string | null) => {
      try {
        const loc = await getLocation();

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
            latitude: loc?.lat,
            longitude: loc?.lng,
          }),
        });
      } catch {
        // silent
      }
    },
    [session, user, getLocation]
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

      // Capture + alert (async, non-blocking, silent)
      capturePhoto().then((photo) => sendIntruderAlert(photo));
    } catch {
      setError("Connection error. Try again.");
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
              <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Verifying...</>
            ) : (
              "Unlock Dashboard"
            )}
          </button>
        </form>

        <p className="text-xs text-dark-600 text-center mt-6">
          All access attempts are monitored and logged
        </p>
      </div>
    </div>
  );
}