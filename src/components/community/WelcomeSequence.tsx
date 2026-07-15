"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { QuickAddSheet } from "./QuickAddSheet";
import { MapPin, ShieldCheck, Users } from "lucide-react";

// New users land on a MAP they don't yet understand and an EMPTY circle.
// A coach-mark tour of empty space teaches nothing, so instead: three
// friendly cards that say what peja is, ask for location with the reason,
// and drive the one action that matters most - adding their people.
// Shows once (localStorage), skippable, and quiets the old feed-era
// tutorial so the two never fight (PEJA_HOME_V2_PLAN.md Batch F).

const SEEN_KEY = "peja-welcome-v2-seen";
// Keys the legacy TutorialOverlay checks - set them so it stays silent
// for users who've been through this newer intro.
const TUTORIAL_COMPLETED_KEY = "peja-tutorial-completed";
const TUTORIAL_HAS_LOGIN_KEY = "peja-has-logged-in";

export function WelcomeSequence() {
  const { user, loading } = useAuth();
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    let replay = false;
    try {
      replay = localStorage.getItem("peja-replay-welcome") === "1";
      if (!replay && localStorage.getItem(SEEN_KEY) === "true") return;
      // Keep the legacy coach-mark tutorial dormant from the start.
      localStorage.setItem(TUTORIAL_COMPLETED_KEY, "true");
      localStorage.setItem(TUTORIAL_HAS_LOGIN_KEY, "true");
    } catch {}
    // Consume the replay flag only at open time. StrictMode runs this
    // effect twice (setup, cleanup, setup); removing the flag eagerly let
    // run #1 eat it while its timer got cancelled, so run #2 bailed and
    // the tutorial never appeared.
    const t = setTimeout(() => {
      try { localStorage.removeItem("peja-replay-welcome"); } catch {}
      setStep(0);
      setOpen(true);
    }, replay ? 50 : 900);
    return () => clearTimeout(t);
  }, [user, loading]);

  // Bulletproof replay: the Settings button sets a flag then navigates
  // home. If this component was already mounted (no remount), catch the
  // flag on focus / visibility / a short poll after arriving.
  useEffect(() => {
    if (!user) return;
    const check = () => {
      try {
        if (localStorage.getItem("peja-replay-welcome") === "1") {
          localStorage.removeItem("peja-replay-welcome");
          setStep(0);
          setOpen(true);
        }
      } catch {}
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const poll = setInterval(check, 600);
    const stopPoll = setTimeout(() => clearInterval(poll), 4000);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      clearInterval(poll);
      clearTimeout(stopPoll);
    };
  }, [user]);

  const finish = () => {
    try {
      localStorage.setItem(SEEN_KEY, "true");
      localStorage.setItem(TUTORIAL_HAS_LOGIN_KEY, "true");
      localStorage.setItem(TUTORIAL_COMPLETED_KEY, "true");
    } catch {}
    setOpen(false);
  };

  const requestLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(() => setStep(2), () => setStep(2), {
        enableHighAccuracy: false,
        timeout: 10_000,
      });
    } else {
      setStep(2);
    }
  };

  if (!user) return null;

  const cards = [
    {
      icon: <ShieldCheck className="w-10 h-10 text-primary-300" />,
      title: `Welcome, ${(user.full_name || "").split(" ")[0] || "friend"}`,
      body: "Peja is your live safety map. See incidents around you in real time, and let the people you trust look out for you.",
      cta: "Next",
      onCta: () => setStep(1),
      secondary: null,
    },
    {
      icon: <MapPin className="w-10 h-10 text-primary-300" />,
      title: "This is your safety map",
      body: "The dot in the middle is you. Hold the SOS button any time you need help, and turn on location so your people can find you in an emergency.",
      cta: "Turn on location",
      onCta: requestLocation,
      secondary: { label: "Skip for now", onClick: () => setStep(2) },
    },
    {
      icon: <Users className="w-10 h-10 text-primary-300" />,
      title: "Peja works with your people",
      body: "Add the ones who'd want to know you're safe. When you accept each other, you watch over one another on the map and in emergencies.",
      cta: "Add your people",
      onCta: () => setQuickAdd(true),
      secondary: { label: "Maybe later", onClick: finish },
    },
  ];

  const c = cards[step];

  return (
    <>
      {open && !quickAdd && (
      <div className="fixed inset-0 z-[140000] flex items-center justify-center p-6">
        <div className="absolute inset-0 bg-black/75" />
        <div
          className="relative w-full max-w-sm rounded-3xl p-7 text-center beacon-pop"
          style={{
            background: "var(--glass-strong-bg)",
            border: "1px solid var(--glass-border-strong)",
            boxShadow: "var(--glass-shadow-strong)",
          }}
        >
          {/* step dots */}
          <div className="flex justify-center gap-1.5 mb-5">
            {cards.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-5 bg-primary-500" : "w-1.5 bg-dark-600"
                }`}
              />
            ))}
          </div>

          <div className="mx-auto w-20 h-20 rounded-full bg-primary-500/15 border border-primary-500/25 flex items-center justify-center mb-5">
            {c.icon}
          </div>
          <h2 className="text-xl font-bold text-dark-50 mb-2">{c.title}</h2>
          <p className="text-[15px] text-dark-300 leading-relaxed mb-6">{c.body}</p>

          <button
            onClick={c.onCta}
            className="w-full py-3.5 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.98] transition-transform"
          >
            {c.cta}
          </button>
          {c.secondary && (
            <button
              onClick={c.secondary.onClick}
              className="w-full mt-2 py-2.5 text-sm font-medium text-dark-400 active:scale-[0.98] transition-transform"
            >
              {c.secondary.label}
            </button>
          )}
        </div>
      </div>
      )}

      {/* Adding people from the last card finishes onboarding. */}
      <QuickAddSheet
        open={quickAdd}
        onClose={() => {
          setQuickAdd(false);
          finish();
        }}
      />
    </>
  );
}
