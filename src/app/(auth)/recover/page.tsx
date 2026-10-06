"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PasswordStrength, isPasswordStrong } from "@/components/ui/PasswordStrength";

/**
 * Recovery through trusted contacts, for someone who cannot receive a
 * code at all: no access to the inbox, no notifications, no saved codes.
 *
 * Four steps: name the account, choose who to ask, wait, set a password.
 *
 * Nothing on this screen confirms whether an account exists. The contact
 * list comes back empty for an unknown address exactly as it does for an
 * account with no contacts, so the page cannot be used to probe for
 * registered emails.
 */
type Step = "email" | "choose" | "waiting" | "reset";

export default function RecoverPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);
  const [required, setRequired] = useState(2);
  const [chosen, setChosen] = useState<string[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [state, setState] = useState<{ status: string; approvals: number; unlockAt: string | null; ready: boolean } | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lookup = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/recovery/start?email=${encodeURIComponent(email.trim())}`);
      const data = await res.json();
      setContacts(data.contacts || []);
      setRequired(data.required || 2);
      setStep("choose");
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/recovery/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), approverIds: chosen }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Could not start recovery");
        return;
      }
      setStep("waiting");
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // Poll while waiting. The request id is not returned by `start` on
  // purpose, so the waiting screen asks the user to follow the link in
  // their own notification once a contact approves.
  const poll = useCallback(async () => {
    if (!requestId) return;
    try {
      const res = await fetch(`/api/recovery/status?id=${encodeURIComponent(requestId)}`);
      const data = await res.json();
      if (data.ok) setState(data);
      if (data.ready) setStep("reset");
    } catch {}
  }, [requestId]);

  useEffect(() => {
    if (step !== "waiting" || !requestId) return;
    poll();
    const t = setInterval(poll, 10_000);
    return () => clearInterval(t);
  }, [step, requestId, poll]);

  useEffect(() => {
    if (!state?.unlockAt) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, Math.floor((Date.parse(state.unlockAt as string) - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [state?.unlockAt]);

  const finish = async () => {
    if (!isPasswordStrong(password)) {
      setError("Password doesn't meet the requirements");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/recovery/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Could not set the password");
        return;
      }
      router.replace("/login");
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/peja-logo.png.png" alt="" className="w-16 h-16 mx-auto mb-4 object-contain" />
          <h1 className="text-2xl font-bold text-dark-50">Recover your account</h1>
          <p className="text-sm text-dark-400 mt-2">
            Ask people who already vouch for you to confirm it is really you.
          </p>
        </div>

        <div className="glass-card space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}

          {step === "email" && (
            <>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email"
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-primary-500/50 placeholder:text-dark-500"
              />
              <Button size="sm" onClick={lookup} disabled={busy || !email.trim()}>
                Continue
              </Button>
            </>
          )}

          {step === "choose" && (
            <>
              {contacts.length < required ? (
                <div className="text-center space-y-3 py-2">
                  <Users className="w-8 h-8 text-dark-500 mx-auto" />
                  <p className="text-sm text-dark-300">
                    This route needs at least {required} accepted emergency
                    contacts on the account.
                  </p>
                  <p className="text-sm text-dark-400">
                    Try a recovery code instead.
                  </p>
                  <Link href="/forgot-password" className="text-sm text-primary-400">
                    Use a recovery code
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-dark-300">
                    Choose at least {required} people to ask. They will get a
                    notification asking whether this is really you.
                  </p>
                  <div className="space-y-1.5">
                    {contacts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => toggle(c.id)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-ui ${
                          chosen.includes(c.id)
                            ? "border-primary-500/50 bg-primary-500/10 text-dark-50"
                            : "border-white/10 bg-white/5 text-dark-200"
                        }`}
                      >
                        <span>{c.name}</span>
                        {chosen.includes(c.id) && <ShieldCheck className="w-4 h-4 text-primary-400" />}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" onClick={start} disabled={busy || chosen.length < required}>
                    Ask {chosen.length || required} {chosen.length === 1 ? "person" : "people"}
                  </Button>
                </>
              )}
            </>
          )}

          {step === "waiting" && (
            <div className="text-center space-y-3 py-2">
              <p className="text-dark-100 font-semibold">Request sent</p>
              <p className="text-sm text-dark-400 leading-relaxed">
                We have asked the people you chose. When enough of them confirm,
                you will get a notification with a link to finish.
              </p>
              {state?.unlockAt && left != null && (
                <p className="text-3xl font-black text-dark-50 tabular-nums">
                  {String(Math.floor(left / 60)).padStart(2, "0")}:
                  {String(left % 60).padStart(2, "0")}
                </p>
              )}
              <p className="text-xs text-dark-500">
                There is a short wait after approval before access opens. That
                window is what protects you if the request was not yours.
              </p>
            </div>
          )}

          {step === "reset" && (
            <>
              <p className="text-sm text-dark-300">Set a new password.</p>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-primary-500/50 placeholder:text-dark-500"
              />
              <PasswordStrength password={password} />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm password"
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-primary-500/50 placeholder:text-dark-500"
              />
              <Button size="sm" onClick={finish} disabled={busy}>
                Set password
              </Button>
            </>
          )}

          <p className="text-center text-sm pt-1">
            <Link href="/login" className="text-dark-400 hover:text-dark-200">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
