// src/app/(auth)/forgot-password/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LifeBuoy,
  Lock,
  Mail,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PasswordStrength, isPasswordStrong } from "@/components/ui/PasswordStrength";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { RECOVERY_CATEGORIES, type RecoveryCategoryId } from "@/lib/recoveryCategories";

/**
 * Password reset. Asks WHICH proof the user has before doing anything.
 *
 * This screen used to take an email and immediately mint a six-digit
 * code, delivered by push with email as the fallback. That was wrong, and
 * the reasoning is worth keeping here as well as in the retired route:
 *
 * A reset code only means something if it reaches somewhere the person
 * holding the phone cannot. Pushing it put the code on the lock screen of
 * the very device an attacker would have taken, so physical possession of
 * the phone became the entire authentication. For an app whose users may
 * be followed or living with someone dangerous, locking the real owner out
 * of their SOS button is close to the worst failure available.
 *
 * So there is no send step any more. Both remaining routes prove identity
 * with something that is not the phone in hand:
 *
 *   recovery code - twenty single-use codes saved off-device at signup
 *   contacts      - two trusted people confirm it is really them, at
 *                   /recover, with a delay the owner can cancel inside
 *
 * Nothing here reveals whether an account exists. The redeem endpoint
 * answers "that code is not valid" identically for an unknown address and
 * a wrong code, so this page cannot be used to probe for registered
 * emails.
 */
// Matches MESSAGE_MAX on /api/recovery/request-help. The counter is
// there so nobody writes four paragraphs into a field that silently
// stops accepting them.
const HELP_MESSAGE_MAX = 2000;

type Step = "choose" | "code" | "help";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  // The human route, for someone with neither a saved code nor two
  // reachable contacts. Files a support ticket; grants nothing by itself.
  const [category, setCategory] = useState<RecoveryCategoryId>("no_codes");
  const [helpMessage, setHelpMessage] = useState("");
  const [helpPhone, setHelpPhone] = useState("");
  const [helpName, setHelpName] = useState("");
  const [helpSent, setHelpSent] = useState(false);

  const submitHelp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }
    if (!helpName.trim()) {
      setError("Enter your full name");
      return;
    }
    if (!helpMessage.trim()) {
      setError("Tell us briefly what happened");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/recovery/request-help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          category,
          message: helpMessage.trim(),
          phone: helpPhone.trim(),
          fullName: helpName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      setHelpSent(true);
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }
    if (!code.trim()) {
      setError("Please enter one of your recovery codes");
      return;
    }
    if (!isPasswordStrong(newPassword)) {
      setError("Password doesn't meet the requirements");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/recovery/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }

      const left = typeof data.remaining === "number" ? data.remaining : null;
      setSuccess(
        left != null
          ? `Password changed. You have ${left} recovery ${left === 1 ? "code" : "codes"} left.`
          : "Password changed.",
      );
      setTimeout(() => router.push("/login"), 2200);
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-7 h-7 text-primary-400" />
          </div>
          <h1 className="text-2xl font-bold text-dark-50">Reset Password</h1>
          <p className="text-sm text-dark-400 mt-2">
            {step === "choose"
              ? "Choose how you want to prove it is you"
              : step === "help"
                ? "Tell us what happened and we will help you back in"
                : "Enter one of the twenty codes you saved"}
          </p>
        </div>

        {helpSent ? (
          <div className="glass-card text-center">
            <ShieldCheck className="w-12 h-12 text-green-400 mx-auto mb-4" />
            <p className="text-dark-100 font-medium">Request sent</p>
            <p className="text-sm text-dark-400 mt-2 leading-relaxed">
              A person will look at this and get back to you by email, at the
              address already on your account. Nothing changes on your account
              until then.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 font-medium mt-5"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to Sign In
            </Link>
          </div>
        ) : success ? (
          <div className="glass-card text-center">
            <ShieldCheck className="w-12 h-12 text-green-400 mx-auto mb-4" />
            <p className="text-green-400 font-medium">{success}</p>
            <p className="text-sm text-dark-400 mt-2">Taking you to sign in...</p>
          </div>
        ) : step === "choose" ? (
          <div className="glass-card space-y-3">
            <button
              onClick={() => setStep("code")}
              className="w-full flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10 text-left active:scale-[0.99] transition-ui hover:border-primary-500/40"
            >
              <div className="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5 text-primary-400" />
              </div>
              <span className="flex-1 min-w-0">
                <span className="block text-dark-100 font-medium">
                  I have a recovery code
                </span>
                <span className="block text-sm text-dark-400 mt-0.5">
                  Instant. One of the codes you saved when you signed up.
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
            </button>

            <button
              onClick={() => router.push("/recover")}
              className="w-full flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10 text-left active:scale-[0.99] transition-ui hover:border-primary-500/40"
            >
              <div className="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5 text-primary-400" />
              </div>
              <span className="flex-1 min-w-0">
                <span className="block text-dark-100 font-medium">
                  Ask my emergency contacts
                </span>
                <span className="block text-sm text-dark-400 mt-0.5">
                  Slower. Two of your people confirm it is really you.
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
            </button>

            <button
              onClick={() => setStep("help")}
              className="w-full flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10 text-left active:scale-[0.99] transition-ui hover:border-primary-500/40"
            >
              <div className="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center shrink-0">
                <LifeBuoy className="w-5 h-5 text-primary-400" />
              </div>
              <span className="flex-1 min-w-0">
                <span className="block text-dark-100 font-medium">
                  I cannot use either of these
                </span>
                <span className="block text-sm text-dark-400 mt-0.5">
                  Ask a person for help. We check and get back to you.
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
            </button>

            <p className="text-xs text-dark-500 leading-relaxed pt-1">
              We no longer send reset codes to your phone or inbox. A code
              sent to the device in someone else's hand would prove nothing.
            </p>

            <p className="text-center text-dark-400 text-sm pt-2">
              <Link
                href="/login"
                className="text-primary-400 hover:text-primary-300 font-medium inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" />
                Back to Sign In
              </Link>
            </p>
          </div>
        ) : step === "help" ? (
          <form onSubmit={submitHelp} className="glass-card">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <Input
                type="email"
                label="Email Address"
                placeholder="The email on your peja account"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                leftIcon={<Mail className="w-4 h-4" />}
                disabled={loading}
              />

              <div>
                <label className="block text-sm font-medium text-dark-200 mb-1.5">
                  What happened?
                </label>
                <div className="space-y-1.5">
                  {RECOVERY_CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategory(c.id)}
                      className={`w-full px-3 py-2.5 rounded-xl border text-left transition-ui ${
                        category === c.id
                          ? "border-primary-500/50 bg-primary-500/10"
                          : "border-white/10 bg-white/5"
                      }`}
                    >
                      <span className="block text-sm text-dark-100">{c.label}</span>
                      <span className="block text-xs text-dark-400 mt-0.5">{c.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Input
                type="text"
                label="Your Full Name"
                placeholder="First name and surname, as on the account"
                value={helpName}
                onChange={(e) => {
                  setHelpName(e.target.value.slice(0, 120));
                  setError("");
                }}
                leftIcon={<UserRound className="w-4 h-4" />}
                disabled={loading}
              />

              <div>
                <label className="block text-sm font-medium text-dark-200 mb-1.5">
                  Phone number <span className="text-dark-500 font-normal">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={helpPhone}
                  onChange={(e) => setHelpPhone(e.target.value.slice(0, 40))}
                  placeholder="A number we can reach you on"
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-primary-500/50 placeholder:text-dark-500"
                  disabled={loading}
                />
                <p className="text-xs text-dark-500 mt-1.5">
                  Helps us confirm it is you. We check it against the account.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-200 mb-1.5">
                  Anything else we should know
                </label>
                <textarea
                  value={helpMessage}
                  onChange={(e) => {
                    setHelpMessage(e.target.value.slice(0, HELP_MESSAGE_MAX));
                    setError("");
                  }}
                  rows={4}
                  placeholder="Tell us what happened in your own words"
                  className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm outline-none focus:border-primary-500/50 placeholder:text-dark-500 resize-none"
                  disabled={loading}
                />
                <p className="mt-1 text-[11px] text-dark-500 text-right">
                  {helpMessage.length}/{HELP_MESSAGE_MAX}
                </p>
              </div>
            </div>

            <p className="text-xs text-dark-500 mt-4 leading-relaxed">
              We will reply to the email already on the account, never to an
              address given here. That is what stops someone else using this
              form to take your account.
            </p>

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-4"
              disabled={loading || !email.trim() || !helpName.trim() || !helpMessage.trim()}
            >
              {loading ? (
                <>
                  <PejaSpinner className="w-4 h-4 mr-2" />
                  Sending...
                </>
              ) : (
                "Send request"
              )}
            </Button>

            <button
              type="button"
              onClick={() => {
                setStep("choose");
                setError("");
              }}
              className="w-full text-center text-sm text-dark-400 hover:text-dark-200 mt-4"
            >
              Back
            </button>
          </form>
        ) : (
          <form onSubmit={handleRedeem} className="glass-card">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <Input
                type="email"
                label="Email Address"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                leftIcon={<Mail className="w-4 h-4" />}
                disabled={loading}
              />

              <div>
                <label className="block text-sm font-medium text-dark-200 mb-1.5">
                  Recovery Code
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setError("");
                  }}
                  placeholder="Enter 6-digit code"
                  className="w-full px-4 py-3 glass-input text-xl tracking-[0.4em] text-center font-mono"
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={loading}
                />
                <p className="text-xs text-dark-500 mt-1.5 text-center">
                  Each code works once
                </p>
              </div>

              <Input
                type={showPassword ? "text" : "password"}
                label="New Password"
                placeholder="Create a new password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError("");
                }}
                leftIcon={<Lock className="w-4 h-4" />}
                disabled={loading}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="hover:text-dark-200"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                }
              />

              <PasswordStrength password={newPassword} />

              <Input
                type={showPassword ? "text" : "password"}
                label="Confirm New Password"
                placeholder="Confirm your new password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError("");
                }}
                leftIcon={<Lock className="w-4 h-4" />}
                disabled={loading}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-6"
              disabled={loading || code.length < 6 || !newPassword || !confirmPassword}
            >
              {loading ? (
                <>
                  <PejaSpinner className="w-4 h-4 mr-2" />
                  Resetting...
                </>
              ) : (
                "Reset Password"
              )}
            </Button>

            <div className="flex items-center justify-between mt-4">
              <button
                type="button"
                onClick={() => {
                  setStep("choose");
                  setCode("");
                  setError("");
                }}
                className="text-sm text-dark-400 hover:text-dark-200"
              >
                Back
              </button>
              <Link href="/recover" className="text-sm text-primary-400 hover:text-primary-300">
                Lost your codes?
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
