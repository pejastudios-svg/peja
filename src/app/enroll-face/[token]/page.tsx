"use client";

import { useEffect, useState, use } from "react";
import { ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import FaceLivenessCapture, { type FaceCaptureResult } from "@/components/admin/FaceLivenessCapture";

type Target = { email?: string; fullName?: string };

type TokenCheck =
  | { state: "loading" }
  | { state: "valid"; target: Target; labelHint: string | null; expiresAt: string }
  | { state: "invalid"; reason: string };

type SubmitState =
  | { phase: "idle" }
  | { phase: "capturing" }
  | { phase: "submitting" }
  | { phase: "done"; label: string }
  | { phase: "error"; message: string };

const REASON_MESSAGES: Record<string, string> = {
  not_found: "This enrollment link is invalid.",
  already_used: "This enrollment link has already been used.",
  revoked: "This enrollment link was revoked by an administrator.",
  expired: "This enrollment link has expired. Ask an administrator to issue a new one.",
};

export default function EnrollFacePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [check, setCheck] = useState<TokenCheck>({ state: "loading" });
  const [label, setLabel] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ phase: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/face-enrollment/${token}/`, { credentials: "omit" });
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) {
          setCheck({ state: "valid", target: data.target ?? {}, labelHint: data.labelHint, expiresAt: data.expiresAt });
          if (typeof data.labelHint === "string" && data.labelHint) setLabel(data.labelHint);
        } else {
          setCheck({ state: "invalid", reason: data.reason || "not_found" });
        }
      } catch {
        if (!cancelled) setCheck({ state: "invalid", reason: "not_found" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleCaptureComplete = async (result: FaceCaptureResult) => {
    setSubmit({ phase: "submitting" });
    try {
      const res = await fetch(`/api/face-enrollment/${token}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({
          descriptor: result.descriptor,
          label: label.trim(),
          thumbnail: result.thumbnail,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubmit({ phase: "done", label: data.enrollment?.label || label });
      } else {
        const reason = data.reason ? REASON_MESSAGES[data.reason] : null;
        setSubmit({ phase: "error", message: reason || data.error || "Enrollment failed" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      setSubmit({ phase: "error", message: msg });
    }
  };

  if (check.state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (check.state === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-600/20 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-dark-50">Link Unavailable</h1>
          <p className="text-sm text-dark-400 mt-2">
            {REASON_MESSAGES[check.reason] || "This enrollment link cannot be used."}
          </p>
        </div>
      </div>
    );
  }

  if (submit.phase === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-600/20 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-dark-50">Face Enrolled</h1>
          <p className="text-sm text-dark-400 mt-2">
            Your face was saved as &quot;{submit.label}&quot;. You can close this page.
          </p>
        </div>
      </div>
    );
  }

  const target = check.target;
  const displayName = target.fullName || target.email || "Admin";

  return (
    <div className="min-h-screen bg-dark-950 px-4 py-8">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-primary-400" />
          </div>
          <h1 className="text-2xl font-bold text-dark-50">Face Enrollment</h1>
          <p className="text-sm text-dark-400 mt-2">
            Hi {displayName}, you&apos;ve been invited to enroll your face for admin login.
          </p>
        </div>

        {submit.phase === "idle" && (
          <div className="bg-dark-900 border border-dark-700 rounded-xl p-5 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-dark-200">Label this face</span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value.slice(0, 60))}
                placeholder="e.g. Work laptop, iPhone front cam"
                className="w-full mt-2 px-4 py-3 glass-input"
                maxLength={60}
              />
              <span className="text-xs text-dark-500 mt-1 block">
                Helps an administrator tell your enrollments apart later.
              </span>
            </label>

            <button
              onClick={() => setSubmit({ phase: "capturing" })}
              disabled={!label.trim()}
              className="w-full py-4 bg-primary-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-primary-500 transition-colors"
            >
              Continue
            </button>

            <p className="text-xs text-dark-500 text-center">
              You&apos;ll be asked to look straight, turn your head, and blink. This proves you&apos;re a real person, not a photo.
            </p>
          </div>
        )}

        {submit.phase === "capturing" && (
          <FaceLivenessCapture
            mode="enroll"
            onComplete={handleCaptureComplete}
            onCancel={() => setSubmit({ phase: "idle" })}
          />
        )}

        {submit.phase === "submitting" && (
          <div className="bg-dark-900 border border-dark-700 rounded-xl p-8 text-center">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-dark-300">Saving your enrollment…</p>
          </div>
        )}

        {submit.phase === "error" && (
          <div className="bg-dark-900 border border-red-800 rounded-xl p-5 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm text-red-300 mb-4">{submit.message}</p>
            <button
              onClick={() => setSubmit({ phase: "idle" })}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-500 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
