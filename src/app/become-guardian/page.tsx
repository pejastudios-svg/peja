"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { NIGERIAN_STATES } from "@/lib/types";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/context/ToastContext";
import {
  ArrowLeft,
  Shield,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Users,
  Clock,
  MapPin,
  Award,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function BecomeGuardianPage() {
  const toastApi = useToast();
  const toast = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const isGuardianNow = !!user?.is_guardian || !!user?.is_admin;
  const containerRef = useRef<HTMLDivElement>(null);

  // Prevent scroll on underlying page
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventBodyScroll = (e: TouchEvent) => {
      if (!container.contains(e.target as Node)) {
        e.preventDefault();
      }
    };

    document.addEventListener('touchmove', preventBodyScroll, { passive: false });
    
    return () => {
      document.removeEventListener('touchmove', preventBodyScroll);
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [existingApplication, setExistingApplication] = useState<any>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const [motivation, setMotivation] = useState("");
  const [hoursPerWeek, setHoursPerWeek] = useState("");
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [experience, setExperience] = useState("");

  const hoursOptions = ["1-5 hours", "5-10 hours", "10-20 hours", "20+ hours"];

  useEffect(() => {
    if (user) {
      checkExistingApplication();
    } else {
      setLoading(false);
    }
  }, [user]);

  const checkExistingApplication = async () => {
    if (!user) return;

    try {
      const { data } = await supabase
        .from("guardian_applications")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      setExistingApplication(data);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (user?.status === "suspended") {
      toastApi.warning("Your account is suspended. You cannot apply right now.");
      return;
    }
    if (user?.status === "banned") {
      toastApi.danger("Your account has been banned.");
      return;
    }
    if (!user) {
      router.push("/login");
      return;
    }

    if (!motivation.trim()) {
      setError("Please tell us why you want to be a Guardian");
      return;
    }
    if (!hoursPerWeek) {
      setError("Please select how many hours you can dedicate");
      return;
    }
    if (selectedAreas.length === 0) {
      setError("Please select at least one area you know well");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const { error: insertError } = await supabase
        .from("guardian_applications")
        .insert({
          user_id: user.id,
          motivation: motivation.trim(),
          hours_per_week: hoursPerWeek,
          areas_of_expertise: selectedAreas,
          experience: experience.trim() || null,
        });

      if (insertError) throw insertError;

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Failed to submit application");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleArea = (area: string) => {
    setSelectedAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  };

  if (loading) {
    return (
      <div 
        ref={containerRef}
        className="fixed inset-0 z-50 bg-dark-950 overflow-y-auto overscroll-none"
        style={{ touchAction: 'pan-y' }}
      >
        <header className="fixed top-0 left-0 right-0 z-50 glass-header">
          <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        </header>

        <main className="pt-14 max-w-2xl mx-auto px-4 py-6 space-y-4">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-2xl" />
        </main>
      </div>
    );
  }

  if (existingApplication) {
    return (
      <div 
        ref={containerRef}
        className="fixed inset-0 z-50 bg-dark-950 overflow-y-auto overscroll-none"
        style={{ touchAction: 'pan-y' }}
      >
        <header className="fixed top-0 left-0 right-0 z-50 glass-header">
          <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
            <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/10 rounded-lg">
              <ArrowLeft className="w-5 h-5 text-dark-200" />
            </button>
            <h1 className="text-lg font-semibold text-dark-100">Guardian Application</h1>
            <div className="w-9" />
          </div>
        </header>

        <main className="pt-14 max-w-2xl mx-auto px-4 py-6">
          <div className="glass-card text-center py-12">
            {existingApplication.status === "pending" ? (
              <>
                <Clock className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-dark-100 mb-2">Application Pending</h2>
                <p className="text-dark-400">
                  Your Guardian application is being reviewed. We'll notify you once a decision is made.
                </p>
              </>
            ) : existingApplication.status === "approved" ? (
              isGuardianNow ? (
                <>
                  <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
                  <h2 className="text-xl font-bold text-dark-100 mb-2">You're a Guardian! 🎉</h2>
                  <p className="text-dark-400 mb-4">
                    Thank you for helping keep Peja safe. You can now access the Guardian Dashboard.
                  </p>

                  <Button
                    variant="primary"
                    onClick={() => {
                      if (typeof window !== "undefined" && (window as any).__pejaOverlayOpen) {
                        window.location.assign("/guardian");
                        return;
                      }
                      router.push("/guardian");
                      router.refresh();
                    }}
                  >
                    Open Guardian Dashboard
                  </Button>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-16 h-16 text-orange-400 mx-auto mb-4" />
                  <h2 className="text-xl font-bold text-dark-100 mb-2">Guardian Access Revoked</h2>
                  <p className="text-dark-400">
                    Your Guardian access has been revoked. If you believe this is a mistake, please contact support.
                  </p>
                </>
              )
            ) : (
              <>
                <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-dark-100 mb-2">Application Not Approved</h2>
                <p className="text-dark-400">
                  Unfortunately, your application wasn't approved at this time. Thank you for your interest!
                </p>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (success) {
    return (
      <div 
        ref={containerRef}
        className="fixed inset-0 z-50 bg-dark-950 overflow-y-auto overscroll-none"
        style={{ touchAction: 'pan-y' }}
      >
        <header className="fixed top-0 left-0 right-0 z-50 glass-header">
          <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
            <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/10 rounded-lg">
              <ArrowLeft className="w-5 h-5 text-dark-200" />
            </button>
            <h1 className="text-lg font-semibold text-dark-100">Application Submitted</h1>
            <div className="w-9" />
          </div>
        </header>

        <main className="pt-14 max-w-2xl mx-auto px-4 py-6">
          <div className="glass-card text-center py-12">
            <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-dark-100 mb-2">Application Submitted!</h2>
            <p className="text-dark-400 mb-6">
              Thank you for wanting to help. We'll review your application and get back to you soon.
            </p>
            <Button variant="primary" onClick={() => router.push("/")}>
              Back to Home
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 z-50 bg-dark-950 overflow-y-auto overscroll-none"
      style={{ touchAction: 'pan-y' }}
    >
      <header className="fixed top-0 left-0 right-0 z-50 glass-header">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/10 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Become a Guardian</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto px-4 py-6 pb-20">
        <div className="glass-card mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-xl bg-primary-600/20">
              <Shield className="w-8 h-8 text-primary-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-dark-100">Community Guardians</h2>
              <p className="text-sm text-dark-400">Help keep Peja safe and accurate</p>
            </div>
          </div>
          <p className="text-dark-300 text-sm mb-4">
            Guardians are trusted volunteers who help moderate content, verify incidents, 
            and ensure our community stays safe and informed.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 text-sm text-dark-400">
              <CheckCircle className="w-4 h-4 text-green-400" />
              Review flagged content
            </div>
            <div className="flex items-center gap-2 text-sm text-dark-400">
              <CheckCircle className="w-4 h-4 text-green-400" />
              Verify incidents
            </div>
            <div className="flex items-center gap-2 text-sm text-dark-400">
              <CheckCircle className="w-4 h-4 text-green-400" />
              Guardian badge
            </div>
            <div className="flex items-center gap-2 text-sm text-dark-400">
              <CheckCircle className="w-4 h-4 text-green-400" />
              Early feature access
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="space-y-6">
          <div className="glass-card">
            <label className="block text-sm font-medium text-dark-200 mb-2">
              Why do you want to be a Guardian? *
            </label>
            <textarea
              value={motivation}
              onChange={(e) => setMotivation(e.target.value)}
              placeholder="Tell us why you want to help moderate Peja..."
              rows={4}
              className="w-full px-4 py-3 glass-input resize-none text-base"
            />
          </div>

          <div className="glass-card">
            <label className="block text-sm font-medium text-dark-200 mb-3">
              How much time can you dedicate weekly? *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {hoursOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setHoursPerWeek(option)}
                  className={`p-3 rounded-xl text-sm transition-colors ${
                    hoursPerWeek === option
                      ? "bg-primary-600 text-white"
                      : "glass-sm text-dark-300 hover:bg-white/10"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="glass-card">
            <label className="block text-sm font-medium text-dark-200 mb-3">
              Which areas/states do you know well? *
            </label>
            <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
              {NIGERIAN_STATES.map((state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => toggleArea(state)}
                  className={`p-2 rounded-lg text-xs transition-colors ${
                    selectedAreas.includes(state)
                      ? "bg-primary-600/20 text-primary-400 border border-primary-500/50"
                      : "glass-sm text-dark-300 hover:bg-white/5"
                  }`}
                >
                  {state}
                </button>
              ))}
            </div>
            <p className="text-xs text-dark-500 mt-2">
              Selected: {selectedAreas.length} states
            </p>
          </div>

          <div className="glass-card">
            <label className="block text-sm font-medium text-dark-200 mb-2">
              Any relevant experience? (Optional)
            </label>
            <textarea
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              placeholder="E.g., community moderation, emergency response, etc."
              rows={3}
              className="w-full px-4 py-3 glass-input resize-none text-base"
            />
          </div>

          <Button
            variant="primary"
            className="w-full"
            onClick={handleSubmit}
            isLoading={submitting}
          >
            Submit Application
          </Button>
        </div>
      </main>
    </div>
  );
}