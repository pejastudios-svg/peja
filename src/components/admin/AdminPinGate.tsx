"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Lock, Eye, EyeOff, ShieldAlert, AlertTriangle, Smartphone, KeyRound, Camera, CameraOff, ScanFace } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import FaceLivenessCapture, { type FaceCaptureResult } from "./FaceLivenessCapture";

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes of inactivity

export default function AdminPinGate({ children }: { children: React.ReactNode }) {
  const { session, user } = useAuth();
  const [phase, setPhase] = useState<"checking" | "pin" | "face" | "totp" | "unlocked">("checking");
  const [pin, setPin] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [error, setError] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [faceEnabled, setFaceEnabled] = useState(false);
  const [faceError, setFaceError] = useState("");
  const [faceVerifying, setFaceVerifying] = useState(false);
  const [backupWarning, setBackupWarning] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState<"checking" | "granted" | "denied" | "needsRequest">("checking");
  const [requestingCamera, setRequestingCamera] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const totpInputRef = useRef<HTMLInputElement>(null);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Attach stream to a hidden video element
  const attachStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
    const video = document.createElement("video");
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    video.muted = true;
    video.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(video);
    video.play().catch(() => {});
    videoRef.current = video;
  }, []);

  // Request camera (called either silently on mount when previously granted, or via button click)
  const requestCamera = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("denied");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      attachStream(stream);
      setCameraStatus("granted");
      return true;
    } catch {
      setCameraStatus("denied");
      return false;
    }
  }, [attachStream]);

  // Detect camera permission state on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (mounted) setCameraStatus("denied");
        return;
      }
      const permStatus = await navigator.permissions
        .query({ name: "camera" as PermissionName })
        .catch(() => null);
      if (!mounted) return;
      if (permStatus?.state === "granted") {
        await requestCamera();
      } else if (permStatus?.state === "denied") {
        setCameraStatus("denied");
      } else {
        // "prompt" or Permissions API unsupported (e.g. iOS Safari) — require an explicit user gesture
        setCameraStatus("needsRequest");
      }
    })();
    return () => {
      mounted = false;
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
      if (videoRef.current) { videoRef.current.remove(); videoRef.current = null; }
    };
  }, [requestCamera]);

  const handleEnableCamera = async () => {
    setRequestingCamera(true);
    await requestCamera();
    setRequestingCamera(false);
  };

  // Release the hidden pre-loaded camera stream when entering the face
  // phase (FaceLivenessCapture needs to claim the device — most browsers
  // serialise camera access to one consumer at a time), and on unlock.
  useEffect(() => {
    if (phase === "face" || phase === "unlocked") {
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
      if (videoRef.current) { videoRef.current.remove(); videoRef.current = null; }
    }
  }, [phase]);

  // Check existing session + TOTP status + face enrollment status on mount
  useEffect(() => {
    (async () => {
      try {
        const [sessionRes, totpRes, faceRes] = await Promise.all([
          fetch("/api/admin/check-session/", { credentials: "include" }),
          session?.access_token
            ? fetch("/api/admin/totp/status/", {
                headers: { Authorization: `Bearer ${session.access_token}` },
              })
            : Promise.resolve(null),
          session?.access_token
            ? fetch("/api/admin/face/status/", {
                headers: { Authorization: `Bearer ${session.access_token}` },
              })
            : Promise.resolve(null),
        ]);

        const sessionData = await sessionRes.json();
        const totpData = totpRes ? await totpRes.json() : null;
        const faceData = faceRes ? await faceRes.json() : null;

        if (totpData?.enabled) setTotpEnabled(true);
        if (faceData?.enabled) setFaceEnabled(true);

        if (sessionData.valid) {
          const faceVerified = sessionStorage.getItem("peja-admin-face-verified");
          const totpVerified = sessionStorage.getItem("peja-admin-totp-verified");
          if (faceData?.enabled && faceVerified !== "true") {
            setPhase("face");
          } else if (totpData?.enabled && totpVerified !== "true") {
            setPhase("totp");
          } else {
            setPhase("unlocked");
          }
        } else {
          setPhase("pin");
        }
      } catch {
        setPhase("pin");
      }
    })();
  }, [session?.access_token]);

  // Auto-lock on inactivity
  useEffect(() => {
    if (phase !== "unlocked") return;

    const resetTimer = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      inactivityTimer.current = setTimeout(async () => {
        setPhase("pin");
        setPin("");
        setTotpCode("");
        setFaceError("");
        sessionStorage.removeItem("peja-admin-totp-verified");
        sessionStorage.removeItem("peja-admin-face-verified");
        try {
          await fetch("/api/admin/logout-session/", { method: "POST", credentials: "include" });
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
  }, [phase]);

  // Lockout countdown
  useEffect(() => {
    if (!lockedUntil) return;
    const iv = setInterval(() => {
      if (Date.now() >= lockedUntil) { setLockedUntil(null); setAttemptsRemaining(5); }
    }, 1000);
    return () => clearInterval(iv);
  }, [lockedUntil]);

  // Focus inputs
  useEffect(() => {
    if (phase === "pin") setTimeout(() => inputRef.current?.focus(), 100);
    if (phase === "totp") setTimeout(() => totpInputRef.current?.focus(), 100);
  }, [phase]);

  // Capture photo
  const capturePhoto = useCallback(async (): Promise<string | null> => {
    try {
      const video = videoRef.current;
      if (!video || !streamRef.current) {
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
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch { return null; }
  }, []);

  // Get location
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
    } catch { return null; }
  }, []);

  // Send intruder alert
  const sendIntruderAlert = useCallback(
    async (photo: string | null) => {
      try {
        const loc = await getLocation();
        await fetch("/api/admin/intruder-alert/", {
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
      } catch {}
    },
    [session, user, getLocation]
  );

  // Submit PIN
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim() || loading) return;
    if (lockedUntil && Date.now() < lockedUntil) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/verify-pin/", {
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
        setError("");
        if (faceEnabled) {
          setPhase("face");
        } else if (totpEnabled) {
          setPhase("totp");
        } else {
          sessionStorage.setItem("peja-admin-totp-verified", "true");
          sessionStorage.setItem("peja-admin-face-verified", "true");
          setPhase("unlocked");
        }
        return;
      }

      setPin("");
      if (data.locked) {
        setLockedUntil(Date.now() + (data.lockout_minutes || 5) * 60_000);
        setError(`Locked for ${data.lockout_minutes} minutes.`);
      } else {
        setAttemptsRemaining(data.attempts_remaining ?? 4);
        setError(data.error || "Incorrect PIN");
      }

      capturePhoto().then((photo) => sendIntruderAlert(photo));
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // Submit face descriptor
  const handleFaceComplete = async (result: FaceCaptureResult) => {
    setFaceVerifying(true);
    setFaceError("");
    try {
      const res = await fetch("/api/admin/face/verify/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ descriptor: result.descriptor }),
      });
      const data = await res.json();

      if (data.ok) {
        sessionStorage.setItem("peja-admin-face-verified", "true");
        if (totpEnabled) {
          setPhase("totp");
        } else {
          sessionStorage.setItem("peja-admin-totp-verified", "true");
          setPhase("unlocked");
        }
        return;
      }

      setFaceError(
        data.reason === "no_enrollments"
          ? "No faces are enrolled yet."
          : `No match (distance ${typeof data.distance === "number" ? data.distance.toFixed(3) : "?"}). Try again or use a backup code.`
      );

      // Failed face = same intruder-capture flow as failed PIN/TOTP
      capturePhoto().then((photo) => sendIntruderAlert(photo));
    } catch {
      setFaceError("Connection error. Try again.");
    } finally {
      setFaceVerifying(false);
    }
  };

  const skipFaceToBackupCode = () => {
    if (!totpEnabled) return;
    setUseBackupCode(true);
    setTotpCode("");
    setFaceError("");
    setPhase("totp");
  };

  // Submit TOTP
  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCode.trim() || loading) return;

    setError("");
    setBackupWarning(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/totp/verify/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({
          code: totpCode.trim(),
          isBackupCode: useBackupCode,
        }),
      });

      const data = await res.json();

      if (data.ok) {
        sessionStorage.setItem("peja-admin-totp-verified", "true");
        if (data.warning) setBackupWarning(data.warning);
        setPhase("unlocked");
        return;
      }

      setTotpCode("");
      setError(data.error || "Invalid code");

      // Intruder alert on failed TOTP
      capturePhoto().then((photo) => sendIntruderAlert(photo));
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (phase === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (phase === "unlocked") return <>{children}</>;

  // Camera gate — must be cleared before PIN entry
  if (cameraStatus !== "granted") {
    const blocked = cameraStatus === "denied";
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4">
        <div className="w-full max-w-sm text-center">
          <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center mx-auto mb-4 ${blocked ? "bg-red-600/20 border-red-500/30" : "bg-primary-600/20 border-primary-500/30"}`}>
            {blocked ? (
              <CameraOff className="w-8 h-8 text-red-400" />
            ) : (
              <Camera className="w-8 h-8 text-primary-400" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-dark-50">
            {blocked ? "Camera Access Blocked" : "Camera Access Required"}
          </h1>
          <p className="text-sm text-dark-400 mt-2 mb-6">
            {blocked
              ? "Admin login is unavailable without camera access. Enable the camera for this site in your browser settings, then reload."
              : "Admin access requires camera permission."}
          </p>

          {cameraStatus === "checking" && (
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          )}

          {cameraStatus === "needsRequest" && (
            <button
              onClick={handleEnableCamera}
              disabled={requestingCamera}
              className="w-full py-4 bg-primary-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-primary-500 transition-colors flex items-center justify-center gap-2"
            >
              {requestingCamera ? (
                <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Requesting...</>
              ) : (
                <><Camera className="w-5 h-5" /> Enable Camera & Continue</>
              )}
            </button>
          )}

          {blocked && (
            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-500 transition-colors"
            >
              Reload
            </button>
          )}

        
        </div>
      </div>
    );
  }

  const remaining = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center mx-auto mb-4">
            {phase === "pin" ? (
              <ShieldAlert className="w-8 h-8 text-primary-400" />
            ) : phase === "face" ? (
              <ScanFace className="w-8 h-8 text-primary-400" />
            ) : (
              <Smartphone className="w-8 h-8 text-primary-400" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-dark-50">
            {phase === "pin"
              ? "Admin Access"
              : phase === "face"
              ? "Face Verification"
              : "Two-Factor Authentication"}
          </h1>
          <p className="text-sm text-dark-400 mt-2">
            {phase === "pin"
              ? "Enter your admin PIN to continue"
              : phase === "face"
              ? "Verify your face to continue"
              : useBackupCode
              ? "Enter a backup recovery code"
              : "Enter the 6-digit code from your authenticator app"}
          </p>
        </div>

        {/* PIN Form */}
        {phase === "pin" && (
          <form onSubmit={handlePinSubmit} className="space-y-4">
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
                inputMode="text"
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
                "Continue"
              )}
            </button>
          </form>
        )}

        {/* Face Verification */}
        {phase === "face" && (
          <div className="space-y-4">
            {faceVerifying ? (
              <div className="bg-dark-900 border border-dark-700 rounded-xl p-8 text-center">
                <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-dark-300">Matching face…</p>
              </div>
            ) : (
              <FaceLivenessCapture mode="verify" onComplete={handleFaceComplete} />
            )}

            {faceError && (
              <div className="flex items-start gap-2 text-sm text-red-400 justify-center">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p className="text-center">{faceError}</p>
              </div>
            )}

            {totpEnabled && (
              <button
                type="button"
                onClick={skipFaceToBackupCode}
                className="w-full text-sm text-dark-500 hover:text-dark-300 py-2 transition-colors"
              >
                Can&apos;t use the camera? Use a backup code
              </button>
            )}
          </div>
        )}

        {/* TOTP Form */}
        {phase === "totp" && (
          <form onSubmit={handleTotpSubmit} className="space-y-4">
            <div className="relative">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
              <input
                ref={totpInputRef}
                type="text"
                value={totpCode}
                onChange={(e) => {
                  const v = useBackupCode
                    ? e.target.value.toUpperCase().slice(0, 9)
                    : e.target.value.replace(/\D/g, "").slice(0, 6);
                  setTotpCode(v);
                  setError("");
                }}
                placeholder={useBackupCode ? "XXXX-XXXX" : "000000"}
                className="w-full pl-12 pr-4 py-4 glass-input text-xl tracking-[0.4em] text-center font-mono"
                disabled={loading}
                autoComplete="one-time-code"
                inputMode={useBackupCode ? "text" : "numeric"}
                autoFocus
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-400 justify-center">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!totpCode.trim() || loading}
              className="w-full py-4 bg-primary-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-primary-500 transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Verifying...</>
              ) : (
                "Unlock Dashboard"
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setUseBackupCode(!useBackupCode);
                setTotpCode("");
                setError("");
              }}
              className="w-full text-sm text-dark-500 hover:text-dark-300 py-2 transition-colors"
            >
              {useBackupCode ? "Use authenticator code instead" : "Use a backup code"}
            </button>
          </form>
        )}

       
      </div>
    </div>
  );
}