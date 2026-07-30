import type { Metadata } from "next";
import Link from "next/link";

// Public marketing landing page (no auth). Three audiences:
//  1. Compliance reviewers (Termii/telco sender-ID vetting, app stores)
//     who must see WHAT the business does without hitting a sign-up wall.
//  2. Anyone who lands on peja.life and wants to understand the product.
//  3. Search engines.
//
// Deliberately a SERVER component with zero auth dependency and explicit
// colours (not theme tokens, which flip with light/dark) so it renders
// identically for everyone, logged out or not.

export const metadata: Metadata = {
  title: "peja - Your people, on one safe map",
  description:
    "peja is a personal safety app built for Nigeria. Emergency SOS alerts, safety check-ins, live location sharing with people you trust, and real incident reports near you. Free to start.",
  openGraph: {
    title: "peja - Your people, on one safe map",
    description:
      "Emergency SOS, safety check-ins, and live location with the people you trust. Built for Nigeria.",
    url: "https://peja.life/about",
    siteName: "peja",
    type: "website",
  },
};

const C = {
  bg: "#0a0612",
  bg2: "#0f0a1e",
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  text: "#f5f3ff",
  muted: "#b9b2cc",
  dim: "#857d99",
  violet: "#7c3aed",
  violet2: "#a78bfa",
};

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#beacon", label: "Beacon" },
  { href: "#faq", label: "FAQ" },
];

const FEATURES = [
  {
    tag: "Emergency SOS",
    title: "One hold, and your people know",
    body:
      "Hold the SOS button and everyone you trust is alerted instantly with your live location. They can call you, see exactly where you are, and say they are on the way. No typing, no explaining, no unlocking menus.",
    points: ["Live location sent to every emergency contact", "Responders can confirm they are coming", "Works even when you cannot speak"],
    scene: "sos",
  },
  {
    tag: "Safety check-ins",
    title: "If you do not arrive, they find out",
    body:
      "Heading somewhere and want cover? Start a check-in before you move. Confirm you are safe when you get there. If you do not, peja alerts your emergency contacts automatically with where you were last seen.",
    points: ["Set the window that suits your trip", "Automatic alert if you go silent", "Cancel any time in one tap"],
    scene: "checkin",
  },
  {
    tag: "Live location",
    title: "Everyone on one map, honestly",
    body:
      "See the people who matter on a single live map, and let them see you. Sharing is per person and always consented. You can pause it for anyone, at any moment, without a conversation.",
    points: ["Per person sharing you control", "Honest labels when a position is old", "Pause or resume whenever you want"],
    scene: "map",
  },
  {
    tag: "Incidents near you",
    title: "Know before you drive into it",
    body:
      "Real reports from people around you, on the map and in your feed. Traffic, accidents, robbery, protests.",
    points: ["Reports from your own area", "Confirmed by other people nearby", "Tap for directions around it"],
    scene: "incident",
  },
];

const STEPS = [
  { n: "1", title: "Add your people", body: "Invite the people who would drop everything for you. They accept, and you watch over each other." },
  { n: "2", title: "Go about your day", body: "peja sits quietly in the background, gently, without eating your battery." },
  { n: "3", title: "Help knows where you are", body: "SOS, check-in, or a simple glance at the map. When it matters, nobody has to ask where you went." },
];

const FAQ = [
  {
    q: "Is peja free?",
    a: "Yes. Creating an account, adding your people, SOS alerts, check-ins and location sharing are free to use.",
  },
  {
    q: "Who can see my location?",
    a: "Only the people you have personally added and accepted, and only while you allow it. Sharing is per person and you can pause it for anyone at any time. We do not sell location data.",
  },
  {
    q: "Will it drain my battery?",
    a: "peja tracks gently on purpose. A dead phone cannot call for help, so updates come every few minutes, and only speed up during an SOS or an active check-in, when it actually matters.",
  },
  {
    q: "Does it work if I have no smartphone?",
    a: "We are building peja Beacon, a paired device that gives SOS calling, fall detection and location to family members who do not use smartphones. It is still in development and not available yet. Everything else in peja works today on any smartphone.",
  },
  {
    q: "What if my location is not accurate?",
    a: "peja does its best with the signal your phone has. When a position is rough, we say so and show the area rather than pretending to be exact. When GPS is unavailable, we show the last known position with how old it is.",
  },
];

function Scene({ kind }: { kind: string }) {
  const streets = (
    <svg viewBox="0 0 400 300" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g fill="none" stroke="#ffffff" strokeWidth="16" strokeLinecap="round" opacity="0.05">
        <path d="M-20 80 C 90 55, 160 130, 270 105 S 420 55, 440 90" />
        <path d="M-30 200 C 80 235, 200 165, 300 215 S 430 235, 450 205" />
        <path d="M110 -20 C 95 85, 165 150, 145 245 S 180 340, 165 380" />
        <path d="M300 -10 C 320 75, 260 165, 305 255 S 300 340, 320 380" />
      </g>
    </svg>
  );

  const dot = (x: string, y: string, color: string, letter: string, ring?: boolean) => (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }}>
      <div className="relative">
        {ring && (
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{ background: color, opacity: 0.3 }}
          />
        )}
        <div
          className="relative w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm border-2 border-white/90"
          style={{ background: color, boxShadow: "0 6px 18px rgba(0,0,0,0.4)" }}
        >
          {letter}
        </div>
      </div>
    </div>
  );

  const chip = (x: string, y: string, text: string, accent: string) => (
    <div
      className="absolute -translate-x-1/2 rounded-full px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap"
      style={{
        left: x,
        top: y,
        background: "rgba(20,14,35,0.92)",
        border: `1px solid ${accent}`,
        color: "#fff",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
      }}
    >
      {text}
    </div>
  );

  return (
    <div
      className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden"
      style={{ background: "linear-gradient(160deg,#150e28,#0b0716)", border: `1px solid ${C.border}` }}
    >
      {streets}
      {kind === "sos" && (
        <>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="relative flex items-center justify-center" style={{ width: 150, height: 150 }}>
              <span className="absolute inset-0 rounded-full bg-red-500 animate-ping" style={{ opacity: 0.18 }} />
              <div
                className="relative rounded-full flex items-center justify-center text-white font-extrabold tracking-wider border-[3px] border-white/90"
                style={{ width: 92, height: 92, background: "linear-gradient(135deg,#ef4444,#b91c1c)", fontSize: 20 }}
              >
                SOS
              </div>
            </div>
          </div>
          {dot("18%", "24%", "#0ea5e9", "A")}
          {dot("82%", "74%", "#16a34a", "C")}
          {chip("30%", "10%", "Chidi needs help now", "rgba(239,68,68,0.5)")}
        </>
      )}
      {kind === "checkin" && (
        <>
          {dot("30%", "62%", "#7c3aed", "D", true)}
          {chip("34%", "34%", "Dami checked in safely", "rgba(22,163,74,0.5)")}
          {chip("60%", "72%", "Home in 12 min", "rgba(139,92,246,0.4)")}
        </>
      )}
      {kind === "map" && (
        <>
          {dot("26%", "34%", "#7c3aed", "D")}
          {dot("70%", "30%", "#0ea5e9", "A")}
          {dot("52%", "70%", "#16a34a", "C", true)}
          {chip("52%", "50%", "3 people nearby", "rgba(139,92,246,0.4)")}
        </>
      )}
      {kind === "incident" && (
        <>
          {chip("50%", "24%", "Traffic incident near Yaba", "rgba(245,158,11,0.5)")}
          {chip("40%", "48%", "Robbery reported, Ojo", "rgba(239,68,68,0.45)")}
          {chip("58%", "70%", "Road blocked, Ikeja", "rgba(139,92,246,0.4)")}
        </>
      )}
    </div>
  );
}

export default function LandingPage() {
  return (
    <main style={{ background: C.bg, color: C.text }} className="min-h-screen">
      {/* announcement bar */}
      <div
        className="w-full text-center text-[13px] font-semibold py-2.5 px-4"
        style={{ background: "linear-gradient(90deg,#7c3aed,#a855f7)", color: "#fff" }}
      >
        Built in Nigeria, for Nigerian streets.{" "}
        <Link href="/signup" className="underline underline-offset-2">
          Get started for free
        </Link>
      </div>

      {/* nav */}
      <header
        className="sticky top-0 z-50 backdrop-blur"
        style={{ background: "rgba(10,6,18,0.82)", borderBottom: `1px solid ${C.border}` }}
      >
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/android-chrome-192x192.png" alt="peja" width={32} height={32} className="rounded-lg" />
            <span className="text-lg font-black tracking-[0.2em]" style={{ color: C.violet2 }}>
              PEJA
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-7">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-sm font-medium" style={{ color: C.muted }}>
                {n.label}
              </a>
            ))}
          </nav>
          <Link
            href="/signup"
            className="px-4 py-2 rounded-full text-sm font-bold"
            style={{ background: C.violet, color: "#fff" }}
          >
            Get started
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(90% 60% at 50% 0%, rgba(124,58,237,0.28), transparent 60%), radial-gradient(70% 50% at 85% 100%, rgba(14,165,233,0.14), transparent 60%)",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-5 pt-16 pb-20 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p
              className="inline-block text-[12px] font-bold px-3 py-1.5 rounded-full mb-5"
              style={{ background: "rgba(139,92,246,0.16)", color: C.violet2, border: `1px solid rgba(139,92,246,0.3)` }}
            >
              Personal safety, built for Nigeria
            </p>
            <h1 className="text-4xl sm:text-5xl font-black leading-[1.08] mb-5">
              Your people,
              <br />
              on one safe map
            </h1>
            <p className="text-lg leading-relaxed mb-8" style={{ color: C.muted }}>
              Emergency SOS, safety check-ins, and live location with the people
              you trust. So when something happens, nobody has to ask where you
              are.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="px-6 py-3.5 rounded-2xl font-bold"
                style={{ background: C.violet, color: "#fff", boxShadow: "0 14px 34px rgba(124,58,237,0.4)" }}
              >
                Get started for free
              </Link>
              <a
                href="https://play.google.com/store/apps/details?id=com.peja.app"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3.5 rounded-2xl font-bold"
                style={{ border: `1px solid ${C.border}`, color: C.text }}
              >
                Get the Android app
              </a>
            </div>
            <p className="text-xs mt-4" style={{ color: C.dim }}>
              Free to start. No card needed.
            </p>
          </div>
          <Scene kind="map" />
        </div>
      </section>

      {/* value strip */}
      <section style={{ borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, background: C.bg2 }}>
        <div className="max-w-6xl mx-auto px-5 py-10 grid sm:grid-cols-3 gap-8 text-center">
          {[
            { k: "One hold", v: "to alert everyone who cares" },
            { k: "Every trip", v: "covered by an automatic check-in" },
            { k: "Your call", v: "who sees you, and when" },
          ].map((s) => (
            <div key={s.k}>
              <p className="text-xl font-black" style={{ color: C.violet2 }}>
                {s.k}
              </p>
              <p className="text-sm mt-1" style={{ color: C.muted }}>
                {s.v}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* features */}
      <section id="features" className="max-w-6xl mx-auto px-5 py-20">
        <h2 className="text-3xl font-black mb-3">What peja does</h2>
        <p className="text-base mb-14 max-w-xl" style={{ color: C.muted }}>
          Four things, done properly, for the moments that actually matter.
        </p>
        <div className="space-y-20">
          {FEATURES.map((f, i) => (
            <div key={f.tag} className="grid md:grid-cols-2 gap-10 items-center">
              <div className={i % 2 === 1 ? "md:order-2" : ""}>
                <p className="text-[12px] font-bold uppercase tracking-widest mb-3" style={{ color: C.violet2 }}>
                  {f.tag}
                </p>
                <h3 className="text-2xl font-black mb-4 leading-tight">{f.title}</h3>
                <p className="text-base leading-relaxed mb-5" style={{ color: C.muted }}>
                  {f.body}
                </p>
                <ul className="space-y-2.5">
                  {f.points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm" style={{ color: C.muted }}>
                      <span
                        className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: C.violet2 }}
                      />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={i % 2 === 1 ? "md:order-1" : ""}>
                <Scene kind={f.scene} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section id="how" style={{ background: C.bg2, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-6xl mx-auto px-5 py-20">
          <h2 className="text-3xl font-black mb-3">How it works</h2>
          <p className="text-base mb-12 max-w-xl" style={{ color: C.muted }}>
            Three steps, then it looks after you quietly.
          </p>
          <div className="grid sm:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="rounded-3xl p-6"
                style={{ background: C.surface, border: `1px solid ${C.border}` }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-black mb-4"
                  style={{ background: "rgba(139,92,246,0.16)", color: C.violet2 }}
                >
                  {s.n}
                </div>
                <h3 className="font-bold text-lg mb-2">{s.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: C.muted }}>
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* beacon - not shipped yet, so it is clearly marked as upcoming */}
      <section id="beacon" className="max-w-6xl mx-auto px-5 py-20 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: C.violet2 }}>
              peja Beacon
            </p>
            <span
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full"
              style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.35)" }}
            >
              Coming soon
            </span>
          </div>
          <h2 className="text-3xl font-black mb-4 leading-tight">
            For the ones without a smartphone
          </h2>
          <p className="text-base leading-relaxed mb-5" style={{ color: C.muted }}>
            We are working on a small paired device. One press to call for help, automatic fall detection,
            and their location on the same map as everyone else in your circle.
            It is still in testing, and we will not ship it until it is
            dependable enough to trust with someone you love.
          </p>
          <ul className="space-y-2.5 mb-6">
            {["SOS call button", "Automatic fall detection", "Live location on your map", "No smartphone needed"].map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm" style={{ color: C.dim }}>
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: C.dim }} />
                {p}
              </li>
            ))}
          </ul>
          <p className="text-xs" style={{ color: C.dim }}>
            Planned. Not available yet.
          </p>
        </div>
        <div className="relative">
          <div style={{ filter: "blur(3px)", opacity: 0.5 }} aria-hidden>
            <Scene kind="checkin" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className="px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest"
              style={{
                background: "rgba(20,14,35,0.9)",
                color: "#fbbf24",
                border: "1px solid rgba(245,158,11,0.4)",
              }}
            >
              In development
            </span>
          </div>
        </div>
      </section>

      {/* trust and privacy */}
      <section style={{ background: C.bg2, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-6xl mx-auto px-5 py-20">
          <h2 className="text-3xl font-black mb-3">Care, not surveillance</h2>
          <p className="text-base mb-10 max-w-2xl" style={{ color: C.muted }}>
            A safety app only works if you trust it. So here is exactly how peja
            behaves.
          </p>
          <div className="grid sm:grid-cols-2 gap-5">
            {[
              { t: "You choose who sees you", b: "Sharing is per person, always consented, and you can pause it for anyone at any time without explaining yourself." },
              { t: "We do not sell your location", b: "Your location exists to keep you safe and reach the people you picked. That is all it is used for." },
              { t: "We tell you when we are unsure", b: "If a position is rough, we show the area instead of a confident pin. If it is old, we say how old." },
              { t: "Messages are safety only", b: "peja sends transactional safety alerts to you and the emergency contacts you added. No marketing, ever, and never to people you did not add." },
            ].map((x) => (
              <div key={x.t} className="rounded-3xl p-6" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                <h3 className="font-bold mb-2">{x.t}</h3>
                <p className="text-sm leading-relaxed" style={{ color: C.muted }}>
                  {x.b}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-3xl p-6" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.dim }}>
              Examples of the SMS peja sends
            </p>
            <div className="space-y-2.5">
              {[
                "Hello, (contact name) started an emergency SOS. Open the peja app to see their live location and respond. Powered by PEJA STUDIOS LIMITED",
                "Hello, your safety check-in is overdue. Your emergency contacts have been notified. Open peja and tap I'm OK to confirm you are safe. Powered by PEJA STUDIOS LIMITED",
                "Hello, your tracker has been configured and is now connected to your account. Open the peja app to see it on your map. Powered by PEJA STUDIOS LIMITED",
              ].map((m) => (
                <p key={m} className="text-xs font-mono leading-relaxed p-3 rounded-xl" style={{ background: "rgba(0,0,0,0.3)", color: C.muted }}>
                  {m}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* faq */}
      <section id="faq" className="max-w-3xl mx-auto px-5 py-20">
        <h2 className="text-3xl font-black mb-10">Questions people ask</h2>
        <div className="space-y-4">
          {FAQ.map((f) => (
            <details
              key={f.q}
              className="rounded-2xl p-5 group"
              style={{ background: C.surface, border: `1px solid ${C.border}` }}
            >
              <summary className="font-semibold cursor-pointer list-none flex items-center justify-between gap-4">
                {f.q}
                <span style={{ color: C.violet2 }} className="text-xl leading-none group-open:rotate-45 transition-transform">
                  +
                </span>
              </summary>
              <p className="text-sm leading-relaxed mt-3" style={{ color: C.muted }}>
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* final cta */}
      <section className="max-w-6xl mx-auto px-5 pb-20">
        <div
          className="rounded-[32px] p-10 sm:p-14 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.22), rgba(14,165,233,0.12))",
            border: `1px solid rgba(139,92,246,0.3)`,
          }}
        >
          <h2 className="text-3xl sm:text-4xl font-black mb-4 leading-tight">
            The people who love you
            <br />
            should never have to guess
          </h2>
          <p className="text-base mb-8 max-w-lg mx-auto" style={{ color: C.muted }}>
            Set up peja in two minutes. Add your people. Get on with your day.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-4 rounded-2xl font-bold"
            style={{ background: C.violet, color: "#fff", boxShadow: "0 14px 34px rgba(124,58,237,0.4)" }}
          >
            Get started for free
          </Link>
        </div>
      </section>

      {/* footer */}
      <footer style={{ borderTop: `1px solid ${C.border}`, background: C.bg2 }}>
        <div className="max-w-6xl mx-auto px-5 py-12">
          <div className="grid sm:grid-cols-3 gap-10 mb-10">
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/android-chrome-192x192.png" alt="peja" width={30} height={30} className="rounded-lg" />
                <span className="font-black tracking-[0.2em]" style={{ color: C.violet2 }}>
                  PEJA
                </span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: C.dim }}>
                Personal safety for you and the people you trust. Built and
                operated in Nigeria.
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.dim }}>
                Product
              </p>
              <div className="flex flex-col gap-2 text-sm" style={{ color: C.muted }}>
                <a href="#features">Features</a>
                <a href="#how">How it works</a>
                <a href="#beacon">Beacon device (soon)</a>
                <Link href="/signup">Create an account</Link>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.dim }}>
                Company
              </p>
              <div className="flex flex-col gap-2 text-sm" style={{ color: C.muted }}>
                <Link href="/privacy">Privacy Policy</Link>
                <Link href="/terms">Terms of Service</Link>
                <Link href="/help">Help and support</Link>
              </div>
            </div>
          </div>
          <div className="pt-6 text-xs" style={{ borderTop: `1px solid ${C.border}`, color: C.dim }}>
            <p className="mb-1">
              PEJA STUDIOS LIMITED, registered in Nigeria with the Corporate
              Affairs Commission.
            </p>
            <p className="mb-1">Ipaye Road, Ojo, Iba, Lagos, Nigeria.</p>
            <p>peja.life</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
