"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { Bell, Check, MapPin, ShieldCheck, Users, X } from "lucide-react";

// Pre-auth onboarding: the logged-out home. Sells the app in one hero +
// three feature cards, then hands off to signup/login. Guests land here
// from every gated route; there is no browse-as-guest anymore (shared
// post links stay public, that's the one open door).
//
// Illustration system: elements are positioned in the same percent space
// the route SVG draws in (preserveAspectRatio="none"), so dotted routes
// always land exactly under the bubbles they connect, at any card size.

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

// ── building blocks ──

function AvatarDot({
  initial,
  color,
  size = 48,
  ring = false,
}: {
  initial: string;
  color: string;
  size?: number;
  ring?: boolean;
}) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {ring && (
        <>
          <span className="welcome-ping absolute inset-0 rounded-full" style={{ background: color, opacity: 0.35 }} />
          <span className="welcome-ping absolute inset-0 rounded-full" style={{ background: color, opacity: 0.35, animationDelay: "0.7s" }} />
        </>
      )}
      <div
        className="relative w-full h-full rounded-full flex items-center justify-center text-white font-bold border-2 border-white shadow-lg"
        style={{ background: color, fontSize: size * 0.38 }}
      >
        {initial}
      </div>
    </div>
  );
}

// Anchor an element by its CENTER at (x%, y%); inner wrapper floats so
// the centering transform and the float animation never fight.
function At({
  x,
  y,
  float = false,
  delay = "0s",
  children,
}: {
  x: number;
  y: number;
  float?: boolean;
  delay?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
      <div className={float ? "welcome-float" : undefined} style={{ animationDelay: delay }}>
        {children}
      </div>
    </div>
  );
}

// A notification chip floating above the thing it talks about. Centered
// on x% by default; align="left" pins the chip's left edge at x% so it
// can sit near a card edge without being clipped.
function Callout({
  x,
  y,
  align = "center",
  delay = "0.5s",
  children,
}: {
  x: number;
  y: number;
  align?: "center" | "left";
  delay?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`absolute -translate-y-full welcome-pop ${align === "center" ? "-translate-x-1/2" : ""}`}
      style={{ left: `${x}%`, top: `${y}%`, animationDelay: delay }}
    >
      <div
        className="rounded-2xl px-3.5 py-2 text-[13px] font-semibold shadow-xl flex items-center gap-2 whitespace-nowrap"
        style={{ background: "var(--glass-strong-bg)", border: "1px solid var(--glass-border)" }}
      >
        {children}
      </div>
    </div>
  );
}

// Dotted routes in percent space; dots march along the line.
function Routes({ paths }: { paths: string[] }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden>
      {paths.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="var(--color-primary-400)"
          strokeWidth="0.9"
          strokeLinecap="round"
          strokeDasharray="0.01 3.4"
          className="welcome-route"
          opacity="0.75"
        />
      ))}
    </svg>
  );
}

// Soft map streets behind every scene.
function MapBackdrop({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 400" className={`absolute inset-0 w-full h-full ${className}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round" opacity="0.07">
        <path d="M-20 90 C 90 60, 150 150, 260 120 S 420 60, 440 100" />
        <path d="M-30 220 C 80 260, 200 180, 300 240 S 430 260, 450 230" />
        <path d="M120 -20 C 100 90, 170 160, 150 260 S 190 380, 170 430" />
        <path d="M300 -10 C 320 80, 260 180, 310 280 S 300 380, 320 420" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.1">
        <path d="M-20 150 C 120 130, 220 200, 420 160" />
        <path d="M40 -10 C 60 140, 20 260, 60 420" />
        <path d="M230 -10 C 210 120, 250 300, 230 420" />
      </g>
    </svg>
  );
}

// ── the scenes ──

// Hero: YOU in the middle, your people connected to you.
function HeroScene() {
  return (
    <div className="relative w-full h-full">
      <Routes
        paths={[
          "M50 42 L16 20",
          "M50 42 L81 16",
          "M50 42 L84 60",
          "M50 42 L18 66",
        ]}
      />
      <At x={16} y={20} float>
        <div className="welcome-pop"><AvatarDot initial="D" color="#7c3aed" size={52} /></div>
      </At>
      <At x={81} y={16} float delay="0.9s">
        <div className="welcome-pop" style={{ animationDelay: "0.15s" }}><AvatarDot initial="A" color="#0ea5e9" size={48} /></div>
      </At>
      <At x={84} y={60} float delay="1.6s">
        <div className="welcome-pop" style={{ animationDelay: "0.3s" }}><AvatarDot initial="C" color="#16a34a" size={44} /></div>
      </At>
      <At x={18} y={66} float delay="0.5s">
        <div
          className="welcome-pop rounded-full p-3 shadow-xl"
          style={{ background: "var(--glass-strong-bg)", border: "1px solid var(--glass-border)", animationDelay: "0.45s" }}
        >
          <ShieldCheck className="w-6 h-6 text-green-600" strokeWidth={2.2} />
        </div>
      </At>

      {/* you, at the center of it all */}
      <At x={50} y={42}>
        <div className="relative welcome-pop" style={{ width: 72, height: 72, animationDelay: "0.55s" }}>
          <span className="welcome-ping absolute inset-0 rounded-full" style={{ background: "#7c3aed", opacity: 0.3 }} />
          <span className="welcome-ping absolute inset-0 rounded-full" style={{ background: "#7c3aed", opacity: 0.3, animationDelay: "0.8s" }} />
          <div
            className="relative w-full h-full rounded-full flex items-center justify-center text-white text-sm font-extrabold border-[3px] border-white shadow-2xl"
            style={{ background: "linear-gradient(135deg, #8b5cf6, #6d28d9)" }}
          >
            You
          </div>
        </div>
      </At>
    </div>
  );
}

// Card 1: Dami is home, J sees it live. The chip belongs to Dami.
function MapScene() {
  return (
    <div className="relative w-full h-full">
      <MapBackdrop className="text-dark-100" />
      <Routes paths={["M68 26 C 58 40, 46 48, 34 60"]} />

      <At x={72} y={24} float delay="0.8s">
        <div className="welcome-pop" style={{ animationDelay: "0.15s" }}>
          <AvatarDot initial="J" color="#0ea5e9" size={52} />
        </div>
      </At>

      <At x={30} y={68} float>
        <div className="welcome-pop">
          <AvatarDot initial="D" color="#7c3aed" size={56} ring />
        </div>
      </At>

      <Callout x={30} y={53} delay="0.6s">
        <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(22,163,74,0.15)" }}>
          <Check className="w-3.5 h-3.5 text-green-600" strokeWidth={3} />
        </span>
        <span className="text-dark-100">Dami checked in</span>
      </Callout>
    </div>
  );
}

// Card 2: Chidi holds SOS; A and C are alerted and coming.
function SosScene() {
  return (
    <div className="relative w-full h-full">
      <MapBackdrop className="text-dark-100" />
      <Routes paths={["M21 25 C 31 36, 39 44, 46 50", "M79 76 C 70 69, 62 63, 55 58"]} />

      <At x={50} y={54}>
        <div className="relative welcome-pop flex items-center justify-center" style={{ width: 170, height: 170 }}>
          <span className="welcome-ping absolute inset-0 rounded-full bg-red-500" style={{ opacity: 0.22 }} />
          <span className="welcome-ping absolute inset-0 rounded-full bg-red-500" style={{ opacity: 0.22, animationDelay: "0.6s" }} />
          <span className="welcome-ping absolute inset-0 rounded-full bg-red-500" style={{ opacity: 0.22, animationDelay: "1.2s" }} />
          <div
            className="relative rounded-full flex items-center justify-center text-white font-extrabold text-2xl tracking-wider border-[3px] border-white shadow-2xl"
            style={{ width: 104, height: 104, background: "linear-gradient(135deg, #ef4444, #b91c1c)" }}
          >
            SOS
          </div>
        </div>
      </At>

      <At x={21} y={25} float>
        <div className="welcome-pop" style={{ animationDelay: "0.2s" }}>
          <AvatarDot initial="A" color="#0ea5e9" size={50} />
        </div>
      </At>
      <At x={79} y={76} float delay="1.1s">
        <div className="welcome-pop" style={{ animationDelay: "0.35s" }}>
          <AvatarDot initial="C" color="#16a34a" size={46} />
        </div>
      </At>

      <Callout x={7} y={12} align="left" delay="0.7s">
        <Bell className="w-4 h-4 text-red-500 shrink-0" strokeWidth={2.4} />
        <span className="text-dark-100">Chidi needs help now</span>
      </Callout>
    </div>
  );
}

// Card 3: a connected timeline of the app watching over your day.
function AwareScene() {
  const rows = [
    { icon: <MapPin className="w-5 h-5 text-amber-500" strokeWidth={2.2} />, tint: "rgba(245,158,11,0.14)", text: "Traffic incident near Yaba", delay: "0.15s" },
    { icon: <ShieldCheck className="w-5 h-5 text-green-600" strokeWidth={2.2} />, tint: "rgba(22,163,74,0.14)", text: "Ada checked in safely", delay: "0.45s" },
    { icon: <Users className="w-5 h-5 text-primary-500" strokeWidth={2.2} />, tint: "rgba(139,92,246,0.16)", text: "Your circle, watching over you", delay: "0.75s" },
  ];
  return (
    <div className="relative w-full h-full">
      <MapBackdrop className="text-dark-100" />
      <div className="relative h-full flex items-center pl-9 pr-6">
        <div className="relative w-full flex flex-col gap-12">
          {/* the rail threads the icons, first center to last center */}
          <div
            className="absolute w-0"
            style={{ left: 22, top: 22, bottom: 22, borderLeft: "2px dashed var(--color-primary-400)", opacity: 0.5 }}
          />
          {rows.map((row) => (
          <div key={row.text} className="relative welcome-pop flex items-center gap-3.5" style={{ animationDelay: row.delay }}>
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 shadow-lg border"
              style={{ background: "var(--glass-strong-bg)", borderColor: "var(--glass-border)" }}
            >
              <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: row.tint }}>
                {row.icon}
              </span>
            </div>
            <div
              className="rounded-2xl px-3.5 py-2.5 text-[13px] font-semibold shadow-xl"
              style={{ background: "var(--glass-strong-bg)", border: "1px solid var(--glass-border)" }}
            >
              <span className="text-dark-100">{row.text}</span>
            </div>
          </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    key: "map",
    title: "See your world, live",
    body: "Your people appear on the map in real time. Know everyone is okay at a glance, wherever they are.",
    scene: <MapScene />,
  },
  {
    key: "sos",
    title: "Help, one hold away",
    body: "Hold SOS and everyone you trust gets your live location instantly. They can call, respond, and come for you.",
    scene: <SosScene />,
  },
  {
    key: "aware",
    title: "Stay ahead of trouble",
    body: "Real reports from people near you, and check-ins that watch over your trips until you arrive.",
    scene: <AwareScene />,
  },
];

export default function WelcomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  // 0 = hero, 1..3 = feature cards
  const [step, setStep] = useState(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  // Logged-in visitors belong on the map.
  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [user, loading, router]);

  const next = useCallback(() => {
    if (step >= FEATURES.length) router.push("/signup");
    else setStep((s) => s + 1);
  }, [step, router]);

  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // Swipe between cards (pointer events so it works on PC too).
  const onPointerDown = (e: React.PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!swipe.current || step === 0) return;
    const dx = e.clientX - swipe.current.x;
    const dy = e.clientY - swipe.current.y;
    swipe.current = null;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && step < FEATURES.length) setStep(step + 1);
    else if (dx > 0) prev();
  };

  if (loading || user) {
    return (
      <div className="fixed inset-0 bg-dark-950 flex items-center justify-center">
        <PejaSpinner />
      </div>
    );
  }

  const feature = step > 0 ? FEATURES[step - 1] : null;
  const isLast = step === FEATURES.length;

  return (
    <div className="fixed inset-0 overflow-hidden flex flex-col" style={{ background: "var(--color-dark-950)" }}>
      {/* local animation keyframes (stale-SW-proof: shipped with the page) */}
      <style>{`
        @keyframes welcomeFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-7px); }
        }
        @keyframes welcomePing {
          0% { transform: scale(0.6); opacity: 0.45; }
          80%, 100% { transform: scale(1.7); opacity: 0; }
        }
        @keyframes welcomePop {
          0% { transform: scale(0.6) translateY(10px); opacity: 0; }
          70% { transform: scale(1.06) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes welcomeRise {
          0% { transform: translateY(18px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes welcomeRoute {
          to { stroke-dashoffset: -6.82; }
        }
        .welcome-float { animation: welcomeFloat 4.5s ease-in-out infinite; }
        .welcome-ping { animation: welcomePing 2.2s ${EASE} infinite; }
        .welcome-pop { animation: welcomePop 0.55s ${EASE} backwards; }
        .welcome-rise { animation: welcomeRise 0.5s ${EASE} backwards; }
        .welcome-route { animation: welcomeRoute 2.4s linear infinite; }
      `}</style>

      {/* soft backdrop wash */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(120% 70% at 50% -10%, rgba(124,58,237,0.16), transparent 60%), radial-gradient(90% 50% at 80% 110%, rgba(14,165,233,0.10), transparent 60%)",
        }}
      />

      {step === 0 ? (
        /* ── hero ── */
        <div className="relative flex-1 flex flex-col items-center px-6 text-center overflow-hidden">
          <MapBackdrop className="text-dark-100" />

          <div className="relative w-full max-w-sm flex-1 min-h-0">
            <HeroScene />
          </div>

          <div className="relative w-full max-w-sm pb-4">
            <div className="welcome-rise flex items-center justify-center gap-2 mb-4" style={{ animationDelay: "0.1s" }}>
              <span className="text-[26px] font-black tracking-[0.25em] text-primary-500" style={{ fontWeight: 900 }}>PEJA</span>
            </div>
            <h1 className="welcome-rise text-[32px] leading-tight font-black text-dark-50 mb-3" style={{ animationDelay: "0.2s" }}>
              Your people, on one safe map
            </h1>
            <p className="welcome-rise text-[15px] text-dark-400 leading-relaxed mb-8" style={{ animationDelay: "0.3s" }}>
              Peja keeps you and the people you love connected, aware, and safe. Every day, not just emergencies.
            </p>
            <button
              onClick={() => setStep(1)}
              className="welcome-rise w-full py-4 rounded-2xl bg-primary-600 text-white text-[17px] font-bold active:scale-[0.98] transition-transform shadow-xl"
              style={{ animationDelay: "0.4s", boxShadow: "0 12px 32px rgba(124,58,237,0.35)" }}
            >
              Get started
            </button>
            <button
              onClick={() => router.push("/login")}
              className="welcome-rise w-full py-4 text-sm font-semibold text-dark-400 active:scale-[0.98] transition-transform"
              style={{ animationDelay: "0.5s" }}
            >
              Already have an account? <span className="text-primary-500 font-bold">Sign in</span>
            </button>
          </div>
        </div>
      ) : (
        /* ── feature cards ── */
        <div
          className="relative flex-1 flex flex-col px-6 pt-4 overflow-hidden touch-pan-y"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          <div className="w-full max-w-sm mx-auto flex items-center justify-between">
            <button
              onClick={prev}
              aria-label="Back"
              className="p-2 -ml-2 rounded-full text-dark-400 active:scale-90 transition-transform rotate-180"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </button>
            <button
              onClick={() => router.push("/signup")}
              aria-label="Skip to sign up"
              className="p-2 -mr-2 rounded-full text-dark-400 active:scale-90 transition-transform"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* card content, re-popped per step */}
          <div key={step} className="flex-1 min-h-0 w-full max-w-sm mx-auto flex flex-col text-center">
            <h2 className="welcome-rise text-[26px] leading-tight font-black text-dark-50 mt-2 mb-2">{feature!.title}</h2>
            <p className="welcome-rise text-[15px] text-dark-400 leading-relaxed mb-4" style={{ animationDelay: "0.1s" }}>
              {feature!.body}
            </p>
            <div
              className="welcome-rise relative flex-1 min-h-0 rounded-3xl overflow-hidden"
              style={{ animationDelay: "0.15s", background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }}
            >
              {feature!.scene}
            </div>
          </div>

          <div className="w-full max-w-sm mx-auto py-5">
            {/* progress dots */}
            <div className="flex justify-center gap-1.5 mb-5">
              {FEATURES.map((f, i) => (
                <span
                  key={f.key}
                  className="h-1.5 rounded-full"
                  style={{
                    width: i === step - 1 ? 22 : 6,
                    background: i === step - 1 ? "var(--color-primary-600)" : "var(--color-dark-600)",
                    transition: `all 0.35s ${EASE}`,
                  }}
                />
              ))}
            </div>
            <button
              onClick={next}
              className="w-full py-4 rounded-2xl bg-primary-600 text-white text-[17px] font-bold active:scale-[0.98] transition-transform"
              style={{ boxShadow: "0 12px 32px rgba(124,58,237,0.35)" }}
            >
              {isLast ? "Create your account" : "Next"}
            </button>
            {isLast && (
              <button
                onClick={() => router.push("/login")}
                className="w-full py-3.5 text-sm font-semibold text-dark-400 active:scale-[0.98] transition-transform"
              >
                Already have an account? <span className="text-primary-500 font-bold">Sign in</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
