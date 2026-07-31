"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

// Signup email confirmation. The code goes to the address they registered
// with, so completing this proves they can actually receive mail there.

export default function VerifyEmailPage() {
  const router = useRouter();
  const { user, loading, refreshUser } = useAuth();

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const sentOnce = useRef(false);

  // Already verified (or signed out): nothing to do here.
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.email_verified) router.replace("/");
  }, [user, loading, router]);

  const send = useCallback(async () => {
    setSending(true);
    setError("");
    try {
      const { res, data } = await authFetchJson("/api/auth/send-email-verification", {
        method: "POST",
      });
      if (!res.ok) {
        setError(data?.error || "Could not send the code");
        return;
      }
      if (data?.alreadyVerified) {
        await refreshUser?.();
        router.replace("/");
        return;
      }
      setCooldown(60);
    } finally {
      setSending(false);
    }
  }, [refreshUser, router]);

  // Send one automatically on arrival so the mail is already waiting.
  useEffect(() => {
    if (loading || !user || user.email_verified || sentOnce.current) return;
    sentOnce.current = true;
    send();
  }, [loading, user, send]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const { res, data } = await authFetchJson("/api/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        setError(data?.error || "Could not verify");
        return;
      }
      await refreshUser?.();
      router.replace("/");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="fixed inset-0 bg-dark-950 flex items-center justify-center">
        <PejaSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary-500/15 border border-primary-500/25 flex items-center justify-center mb-4">
            <MailCheck className="beacon-accent-text w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-dark-50 mb-2">Confirm your email</h1>
          <p className="text-sm text-dark-400 leading-relaxed">
            We sent a 6-digit code to
            <br />
            <span className="text-dark-200 font-medium">{user.email}</span>
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <input
            inputMode="numeric"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError("");
            }}
            placeholder="000000"
            className="w-full bg-dark-800 border border-dark-600 rounded-2xl px-4 py-4 text-center text-2xl tracking-[0.4em] text-dark-100 placeholder:text-dark-600 focus:outline-none focus:border-primary-500 transition-colors"
          />

          {error && <p className="beacon-bad-text text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={code.length < 6 || busy}
            className="w-full py-3.5 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.98] transition-transform disabled:opacity-40"
          >
            {busy ? "Checking..." : "Confirm email"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={send}
            disabled={sending || cooldown > 0}
            className="text-sm font-medium text-dark-400 disabled:opacity-50"
          >
            {sending
              ? "Sending..."
              : cooldown > 0
                ? `Send again in ${cooldown}s`
                : "Send the code again"}
          </button>
          <p className="text-xs text-dark-600 mt-3 leading-relaxed">
            Check your spam folder if it does not arrive within a minute.
          </p>
        </div>
      </div>
    </div>
  );
}
