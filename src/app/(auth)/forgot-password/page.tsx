// src/app/(auth)/forgot-password/page.tsx
"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Lock, Eye, EyeOff, ArrowLeft, Loader2, ShieldCheck, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PasswordStrength, isPasswordStrong } from "@/components/ui/PasswordStrength";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }

    setLoading(true);

    try {
    const res = await fetch("/api/auth/forgot-password/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }

      setStep(2);
      setTimeout(() => codeInputRef.current?.focus(), 200);
    } catch {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!code.trim()) {
      setError("Please enter the verification code");
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
      const res = await fetch("/api/auth/reset-password/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim(),
          newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }

      setSuccess("Password reset successfully! Redirecting to login...");
      setTimeout(() => router.push("/login"), 2000);
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
            {step === 1
              ? "Enter your email to receive a reset code"
              : `We sent a code to ${email}`}
          </p>
        </div>

        {success ? (
          <div className="glass-card text-center">
            <ShieldCheck className="w-12 h-12 text-green-400 mx-auto mb-4" />
            <p className="text-green-400 font-medium">{success}</p>
          </div>
        ) : step === 1 ? (
          <form onSubmit={handleSendCode} className="glass-card">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

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

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-6"
              disabled={loading || !email.trim()}
            >
              {loading ? (
                <>
                  <PejaSpinner className="w-4 h-4 mr-2" />
                  Sending Code...
                </>
              ) : (
                "Send Reset Code"
              )}
            </Button>

            <p className="text-center text-dark-400 text-sm mt-6">
              <Link
                href="/login"
                className="text-primary-400 hover:text-primary-300 font-medium inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" />
                Back to Sign In
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} className="glass-card">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-dark-200 mb-1.5">
                  Verification Code
                </label>
                <input
                  ref={codeInputRef}
                  type="text"
                  value={code}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setCode(v);
                    setError("");
                  }}
                  placeholder="Enter 6-digit code"
                  className="w-full px-4 py-3 glass-input text-xl tracking-[0.4em] text-center font-mono"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  disabled={loading}
                />
                <p className="text-xs text-dark-500 mt-1.5 text-center">
                  Check your email for the code
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
                  setStep(1);
                  setCode("");
                  setError("");
                }}
                className="text-sm text-dark-400 hover:text-dark-200"
              >
                Use a different email
              </button>
              <button
                type="button"
                onClick={handleSendCode}
                disabled={loading}
                className="text-sm text-primary-400 hover:text-primary-300"
              >
                Resend code
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}