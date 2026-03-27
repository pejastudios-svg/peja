"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/context/AuthContext";
import {
  PlusCircle,
  CheckCircle,
  Map,
  AlertTriangle,
  Bell,
  User,
  ChevronRight,
  X,
  Search,
  Home,
  MapPin,
} from "lucide-react";

// =====================================================
// TUTORIAL STEPS
// =====================================================

export interface TutorialStep {
  id: string;
  target: string; // matches data-tutorial="xxx" on the element
  title: string;
  description: string;
  icon: React.ReactNode;
  position?: "top" | "bottom" | "auto";
}

export const TUTORIAL_STEPS: TutorialStep[] = [
{
    id: "home-feed",
    target: "home-nearby",
    title: "Your Safety Feed",
    description:
      "This is where you see real-time incidents reported by your community. Use Nearby to see what is close to you, or Trending for the most active reports.",
    icon: <Home className="w-5 h-5" />,
    position: "bottom",
  },
  {
    id: "report-button",
    target: "nav-report",
    title: "Report an Incident",
    description:
      "Tap here to report something happening near you. Add photos, videos, your location, and select the right category so others know what is going on.",
    icon: <PlusCircle className="w-5 h-5" />,
    position: "top",
  },
  {
    id: "confirm-button",
    target: "post-confirm",
    title: "Confirm Reports",
    description:
      "If you have witnessed an incident that someone else reported, tap Confirm. This helps verify the report and tells the community it is real.",
    icon: <CheckCircle className="w-5 h-5" />,
    position: "top",
  },
  {
    id: "map-button",
    target: "nav-map",
    title: "Live Safety Map",
    description:
      "View all reported incidents on an interactive map. See what is happening in your area before you step outside.",
    icon: <Map className="w-5 h-5" />,
    position: "top",
  },
  {
    id: "search-button",
    target: "nav-search",
    title: "Search Incidents",
    description:
      "Search for incidents by keyword, #tags, location, or category. Find specific reports quickly.",
    icon: <Search className="w-5 h-5" />,
    position: "top",
  },
  {
    id: "sos-button",
    target: "nav-sos",
    title: "Emergency SOS",
    description:
      "In a real emergency, tap and hold this button. It broadcasts your live location to nearby users and your emergency contacts. Do NOT misuse this. False alerts result in a permanent ban.",
    icon: <AlertTriangle className="w-5 h-5" />,
    position: "top",
  },
  {
    id: "sml-button",
    target: "nav-sml",
    title: "Share My Location",
    description:
      "Tap this to share your live location with your emergency contacts. Set a check-in timer and tap 'I'm OK' before it expires. If you miss a check-in, your contacts are automatically alerted. You can also see when others are sharing their location with you.",
    icon: <MapPin className="w-5 h-5" />,
    position: "top",
  },
  {
    id: "notifications",
    target: "header-notifications",
    title: "Stay Alert",
    description:
      "You will be notified when incidents happen near your location. Never miss an important safety alert.",
    icon: <Bell className="w-5 h-5" />,
    position: "bottom",
  },
  {
    id: "profile",
    target: "header-profile",
    title: "Your Profile",
    description:
      "Manage your account, add emergency contacts, and customize your notification settings. Emergency contacts get alerted when you trigger SOS.",
    icon: <User className="w-5 h-5" />,
    position: "bottom",
  },
];

// =====================================================
// STORAGE
// =====================================================

const TUTORIAL_COMPLETED_KEY = "peja-tutorial-completed";
const TUTORIAL_DISMISSED_KEY = "peja-tutorial-dismissed";

export function isTutorialCompleted(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(TUTORIAL_COMPLETED_KEY) === "true";
}

export function resetTutorial(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TUTORIAL_COMPLETED_KEY);
  localStorage.removeItem(TUTORIAL_DISMISSED_KEY);
}

// =====================================================
// WELCOME SCREEN
// =====================================================

function WelcomeScreen({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div className="fixed inset-0 z-[30000] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-sm rounded-3xl overflow-hidden"
        style={{
          background: "rgba(18, 12, 36, 0.98)",
          border: "1px solid rgba(139, 92, 246, 0.2)",
          boxShadow: "0 0 80px rgba(139, 92, 246, 0.08), 0 25px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Illustration area */}
        <div
          className="relative h-44 flex items-center justify-center overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(139,92,246,0.1) 50%, rgba(59,130,246,0.1) 100%)",
          }}
        >
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-4 left-8 w-20 h-20 rounded-full bg-primary-500/20 blur-2xl" />
            <div className="absolute bottom-4 right-8 w-24 h-24 rounded-full bg-blue-500/15 blur-2xl" />
            <div className="absolute top-8 right-12 w-16 h-16 rounded-full bg-red-500/10 blur-2xl" />
          </div>

          <div className="relative flex flex-col items-center">
          <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center mb-3"
              style={{
                background: "rgba(124, 58, 237, 0.2)",
                border: "2px solid rgba(139, 92, 246, 0.3)",
                boxShadow: "0 0 30px rgba(139, 92, 246, 0.2)",
              }}
            >
              <img
                src="https://plastic-lime-elzghqehop.edgeone.app/peja%20logo%20SINGLE.png"
                alt="Peja"
                className="w-12 h-12 object-contain"
                style={{ filter: "drop-shadow(0 0 4px rgba(167, 139, 250, 0.3))" }}
              />
            </div>
            <span className="text-2xl font-black tracking-[0.2em]" style={{ color: "#a78bfa" }}>
              PEJA
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 text-center">
          <h2 className="text-xl font-bold text-white mb-2">Welcome to Peja</h2>
          <p className="text-sm text-dark-400 leading-relaxed mb-6">
            Your community safety platform. Let us show you around so you can make the most of every feature.
          </p>

          <button
            onClick={onStart}
            className="w-full py-3.5 rounded-xl font-semibold text-white transition-all active:scale-[0.98] mb-3"
            style={{
              background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
              boxShadow: "0 4px 20px rgba(124, 58, 237, 0.4)",
            }}
          >
            Show Me Around
          </button>

          <button
            onClick={onSkip}
            className="w-full py-3 rounded-xl text-sm font-medium text-dark-500 transition-colors hover:text-dark-300 active:bg-white/5"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// SPOTLIGHT OVERLAY
// =====================================================

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function SpotlightOverlay({
  steps,
  currentStep,
  onNext,
  onFinish,
  onSkip,
}: {
  steps: TutorialStep[];
  currentStep: number;
  onNext: () => void;
  onFinish: () => void;
  onSkip: () => void;
}) {
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<"top" | "bottom">("bottom");
  const [windowSize, setWindowSize] = useState({ w: 0, h: 0 });
  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;

 const measureTarget = useCallback(() => {
    if (typeof window === "undefined") return;

    setWindowSize({ w: window.innerWidth, h: window.innerHeight });

    if (!step) return;

    // Open Peja menu for SOS/SML steps
    if (step.target === "nav-sos" || step.target === "nav-sml") {
      window.dispatchEvent(new CustomEvent("peja-tutorial-open-menu"));
    } else {
      window.dispatchEvent(new CustomEvent("peja-tutorial-close-menu"));
    }

    // Small delay for menu animation when opening
    const delay = (step.target === "nav-sos" || step.target === "nav-sml") ? 400 : 0;

    setTimeout(() => {
      const el = document.querySelector(`[data-tutorial="${step.target}"]`);
    if (!el) {
      setSpotlight(null);
      return;
    }

    // Scroll element into view first
    const rect = el.getBoundingClientRect();
    const isVisible =
      rect.top >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.left >= 0 &&
      rect.right <= window.innerWidth;

    if (!isVisible) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      // Re-measure after scroll settles
      setTimeout(() => {
        const newRect = el.getBoundingClientRect();
        const padding = 6;
        setSpotlight({
          top: newRect.top - padding,
          left: newRect.left - padding,
          width: newRect.width + padding * 2,
          height: newRect.height + padding * 2,
        });
      }, 400);
      return;
    }

    const padding = 6;
    setSpotlight({
      top: rect.top - padding,
      left: rect.left - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    });

const preferredPos = step.position || "auto";
    if (preferredPos === "top") {
      setTooltipPos("top");
    } else if (preferredPos === "bottom") {
      setTooltipPos("bottom");
    } else {
      setTooltipPos(rect.top < window.innerHeight / 2 ? "bottom" : "top");
    }
    }, delay);
  }, [step]);

  useEffect(() => {
    measureTarget();
    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget);
    const timer = setTimeout(measureTarget, 150);
    return () => {
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget);
      clearTimeout(timer);
    };
  }, [measureTarget, currentStep]);

  if (!step) return null;

  return (
    <div
      className="fixed inset-0 z-[30000]"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-tooltip-card]")) return;
        if (isLast) onFinish();
        else onNext();
      }}
    >
      {/* Dark overlay with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="tutorial-spotlight-mask">
            <rect x="0" y="0" width={windowSize.w} height={windowSize.h} fill="white" />
            {spotlight && (
              <rect
                x={spotlight.left}
                y={spotlight.top}
                width={spotlight.width}
                height={spotlight.height}
                rx="12"
                fill="black"
                style={{ transition: "all 0.4s cubic-bezier(0.32, 0.72, 0, 1)" }}
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width={windowSize.w}
          height={windowSize.h}
          fill="rgba(0,0,0,0.78)"
          mask="url(#tutorial-spotlight-mask)"
        />
      </svg>

      {/* Spotlight glow ring */}
      {spotlight && (
        <div
          className="absolute rounded-xl pointer-events-none"
          style={{
            top: spotlight.top - 2,
            left: spotlight.left - 2,
            width: spotlight.width + 4,
            height: spotlight.height + 4,
            border: "2px solid rgba(139, 92, 246, 0.5)",
            boxShadow: "0 0 20px rgba(139, 92, 246, 0.3), inset 0 0 20px rgba(139, 92, 246, 0.1)",
            transition: "all 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
          }}
        />
      )}

      {/* Tooltip */}
      <div
        data-tooltip-card
        onClick={(e) => e.stopPropagation()}
        className="absolute"
        style={{
          left: "16px",
          right: "16px",
          maxWidth: "360px",
          margin: "0 auto",
          transition: "all 0.35s cubic-bezier(0.32, 0.72, 0, 1)",
          ...(spotlight
            ? tooltipPos === "bottom"
              ? { top: spotlight.top + spotlight.height + 16 }
              : { bottom: windowSize.h - spotlight.top + 16 }
            : { top: "50%", transform: "translateY(-50%)" }),
        }}
      >
        <div
          className="rounded-2xl p-5 relative overflow-hidden"
          style={{
            background: "rgba(18, 12, 36, 0.97)",
            border: "1px solid rgba(139, 92, 246, 0.2)",
            boxShadow: "0 8px 40px rgba(0,0,0,0.5), 0 0 30px rgba(139, 92, 246, 0.05)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: "rgba(139, 92, 246, 0.15)",
                  border: "1px solid rgba(139, 92, 246, 0.2)",
                }}
              >
                <span style={{ color: "#a78bfa" }}>{step.icon}</span>
              </div>
              <span className="text-xs text-dark-500 font-medium">
                {currentStep + 1} of {steps.length}
              </span>
            </div>
            <button onClick={onSkip} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              <X className="w-4 h-4 text-dark-500" />
            </button>
          </div>

          {/* Content */}
          <h3 className="text-base font-bold text-white mb-1.5">{step.title}</h3>
          <p className="text-sm text-dark-400 leading-relaxed mb-4">{step.description}</p>

          {/* Progress + Next */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className="h-1 rounded-full transition-all duration-300"
                  style={{
                    width: i === currentStep ? "20px" : "6px",
                    background:
                      i === currentStep
                        ? "#a78bfa"
                        : i < currentStep
                        ? "rgba(167,139,250,0.4)"
                        : "rgba(255,255,255,0.1)",
                  }}
                />
              ))}
            </div>

            <button
              onClick={isLast ? onFinish : onNext}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.96]"
              style={{
                background: isLast
                  ? "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)"
                  : "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                boxShadow: isLast
                  ? "0 4px 15px rgba(34,197,94,0.3)"
                  : "0 4px 15px rgba(124,58,237,0.3)",
              }}
            >
              {isLast ? "Got It!" : "Next"}
              {!isLast && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// TUTORIAL PROVIDER (wrap your app with this)
// =====================================================

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<"hidden" | "welcome" | "spotlight">("hidden");
  const [currentStep, setCurrentStep] = useState(0);
  const [mounted, setMounted] = useState(false);
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Only show tutorial when user is logged in
  useEffect(() => {
    if (authLoading || !user) return;
    if (typeof window === "undefined") return;

    const completed = localStorage.getItem(TUTORIAL_COMPLETED_KEY);
    const dismissed = localStorage.getItem(TUTORIAL_DISMISSED_KEY);

    // Check if this is a first-time login (not just first visit)
    const hasSeenLogin = localStorage.getItem("peja-has-logged-in");
    if (!hasSeenLogin) {
      localStorage.setItem("peja-has-logged-in", "true");
      // First login ever - show tutorial after a delay
      if (completed !== "true") {
        const timer = setTimeout(() => setPhase("welcome"), 2000);
        return () => clearTimeout(timer);
      }
    } else if (completed !== "true" && dismissed !== "true") {
      // Returning user who hasn't finished tutorial
      const timer = setTimeout(() => setPhase("welcome"), 2000);
      return () => clearTimeout(timer);
    }
  }, [user, authLoading]);

  // Listen for manual trigger from Settings
  useEffect(() => {
    const handleTrigger = () => {
      setCurrentStep(0);
      setPhase("welcome");
    };

    window.addEventListener("peja-start-tutorial", handleTrigger);
    return () => window.removeEventListener("peja-start-tutorial", handleTrigger);
  }, []);

const handleStart = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      setCurrentStep(0);
      setPhase("spotlight");
    }, 500);
  }, []);

  const handleSkip = useCallback(() => {
    localStorage.setItem(TUTORIAL_DISMISSED_KEY, "true");
    setPhase("hidden");
  }, []);

  const handleNext = useCallback(() => {
    setCurrentStep((prev) => prev + 1);
  }, []);

  const handleFinish = useCallback(() => {
    localStorage.setItem(TUTORIAL_COMPLETED_KEY, "true");
    localStorage.removeItem(TUTORIAL_DISMISSED_KEY);
    setPhase("hidden");
  }, []);

  if (!mounted) return <>{children}</>;

  return (
    <>
      {children}
      {phase === "welcome" && createPortal(<WelcomeScreen onStart={handleStart} onSkip={handleSkip} />, document.body)}
      {phase === "spotlight" && createPortal(
        <SpotlightOverlay
          steps={TUTORIAL_STEPS}
          currentStep={currentStep}
          onNext={handleNext}
          onFinish={handleFinish}
          onSkip={handleSkip}
        />,
        document.body
      )}
    </>
  );
}