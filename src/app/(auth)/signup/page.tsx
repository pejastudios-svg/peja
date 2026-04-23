// src/app/(auth)/signup/page.tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, Eye, EyeOff, User, Phone, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PasswordStrength, isPasswordStrong } from "@/components/ui/PasswordStrength";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { getSafeNext } from "@/lib/safeNext";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getSafeNext(searchParams.get("next"));
  const { signUp, user, loading: authLoading } = useAuth();

  // If an already-authed user lands here (typical: back navigation after a
  // post-signup deep link), bounce straight home.
  useEffect(() => {
    if (authLoading) return;
    if (user) router.replace("/");
  }, [user, authLoading, router]);

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!formData.fullName.trim()) {
      setError("Please enter your full name");
      return;
    }

    if (!formData.email.trim()) {
      setError("Please enter your email");
      return;
    }

    if (!formData.phone.trim()) {
      setError("Please enter your phone number");
      return;
    }

    if (!isPasswordStrong(formData.password)) {
      setError("Password doesn't meet the requirements below");
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const { error: signUpError } = await signUp(
        formData.email.trim(),
        formData.password,
        formData.fullName.trim(),
        formData.phone.trim()
      );

      if (signUpError) {
        if (signUpError.message.includes("already registered")) {
          setError("This email is already registered. Please sign in.");
        } else {
          setError(signUpError.message);
        }
        setLoading(false);
        return;
      }

      if (next) {
        router.replace("/");
        router.push(next);
      } else {
        router.push("/");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + (next || "/"),
        },
      });
      if (error) setError(error.message);
    } catch (e: any) {
      setError(e.message || "Google sign-in failed");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ animation: "fadeIn 0.4s ease" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gradient mb-2">Peja</h1>
          <p className="text-dark-400">Create an account to keep your community safe</p>
        </div>

        <form onSubmit={handleSubmit} className="glass-card">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <Input
              type="text"
              name="fullName"
              label="Full Name"
              placeholder="Enter your full name"
              value={formData.fullName}
              onChange={handleChange}
              leftIcon={<User className="w-4 h-4" />}
              disabled={loading}
            />

            <Input
              type="email"
              name="email"
              label="Email"
              placeholder="Enter your email"
              value={formData.email}
              onChange={handleChange}
              leftIcon={<Mail className="w-4 h-4" />}
              disabled={loading}
            />

            <Input
              type="tel"
              name="phone"
              label="Phone Number"
              placeholder="+234 800 000 0000"
              value={formData.phone}
              onChange={handleChange}
              leftIcon={<Phone className="w-4 h-4" />}
              disabled={loading}
            />

            <div>
              <Input
                type={showPassword ? "text" : "password"}
                name="password"
                label="Password"
                placeholder="Create a strong password"
                value={formData.password}
                onChange={handleChange}
                leftIcon={<Lock className="w-4 h-4" />}
                disabled={loading}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="hover:text-dark-200"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
              <PasswordStrength password={formData.password} />
            </div>

            <Input
              type={showPassword ? "text" : "password"}
              name="confirmPassword"
              label="Confirm Password"
              placeholder="Confirm your password"
              value={formData.confirmPassword}
              onChange={handleChange}
              leftIcon={<Lock className="w-4 h-4" />}
              disabled={loading}
            />
          </div>

          <Button type="submit" variant="primary" className="w-full mt-6" disabled={loading}>
            {loading ? (
              <>
                <PejaSpinner className="w-4 h-4 mr-2" />
                Creating Account...
              </>
            ) : (
              "Create Account"
            )}
          </Button>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-dark-500">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-xl font-medium text-white transition-all active:scale-[0.98] hover:bg-white/10"
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <p className="text-center text-dark-400 text-sm mt-6">
            Already have an account?{" "}
            <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-primary-400 hover:text-primary-300 font-medium">
              Sign in
            </Link>
          </p>

          <p className="text-center text-dark-500 text-xs mt-4">
            By creating an account, you agree to our{" "}
            <Link href="/terms" className="text-primary-400 hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-primary-400 hover:underline">
              Privacy Policy
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}