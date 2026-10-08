"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { BeaconIllustration } from "./BeaconIllustration";

// First-run manual for the Beacon. Shown full screen the first time someone
// opens the Beacon area, BEFORE the pair flow or dashboard. The Continue
// button stays locked until the reader has scrolled to the end, because the
// person setting this device up is usually not the person who will wear it,
// and the questions this page answers (why does the SIM need credit, why
// must I know its number, why will it not turn off with one button) are
// exactly the ones that otherwise come back as support calls.
//
// Facts here must stay in agreement with BeaconManual.tsx, which is the
// reference copy of the device behaviour. If the firmware story changes,
// change both.

const END_SLACK_PX = 32;

// Legend for the numbered chips on the illustration. One source for both
// the chip positions and the list below it.
const PARTS = [
  {
    n: 1,
    name: "SOS button",
    detail:
      "Hold for 3 seconds to trigger an emergency. Your emergency contacts get your live location, and the device calls your number 1 emergency contact so you can speak. A quick press speaks the battery level out loud.",
  },
  {
    n: 2,
    name: "Call buttons",
    detail:
      "Hold the green one to call contact 1, the red one to call contact 2. Quick presses answer and end calls.",
  },
  {
    n: 3,
    name: "Side button",
    detail:
      "Powers the Beacon on. To switch off, press and hold the green call button first, then hold this button immediately after.",
  },
  {
    n: 4,
    name: "Status light",
    detail:
      "On the bottom edge of the device. Green for network, blue for GPS, red while charging.",
  },
  {
    n: 5,
    name: "SIM tray",
    detail:
      "On the left edge, above the side button. Takes a nano SIM. The Beacon works through the mobile network.",
  },
] as const;

const BEFORE_YOU_BEGIN = [
  {
    title: "A nano SIM with airtime",
    detail:
      "The Beacon calls and texts over the mobile network, so the SIM needs credit and an active line. MTN, Glo, Airtel and 9mobile all work.",
  },
  {
    title: "No PIN lock on the SIM",
    detail:
      "Put the SIM in a phone first and switch off its PIN lock. A locked SIM keeps the Beacon silent.",
  },
  {
    title: "Write down the SIM's phone number",
    detail:
      "Pairing asks for it. peja texts the device on that number to set everything up remotely, so it must be exact.",
  },
  {
    title: "A full charge",
    detail:
      "About 4 hours on the USB cable. The light stays red while it charges.",
  },
] as const;

const SETUP_STEPS = [
  {
    title: "Insert the SIM",
    detail:
      "Open the tray on the left edge, above the side button, and seat the nano SIM.",
  },
  {
    title: "Power it on",
    detail:
      "Hold the side button for about 5 seconds, until the green light comes on or you hear the startup tone.",
  },
  {
    title: "Pair it in the app",
    detail:
      "Continue below. You will scan the Beacon or type in its ID number, enter the SIM's phone number, and choose two call contacts. peja sets the device up over the air. There is nothing to type into the device itself.",
  },
  {
    title: "Give it sky",
    detail:
      "Once pairing is complete, take it outside for about 3 minutes so it can find GPS for the first time. After that it locks on much faster.",
  },
] as const;

const EVERY_DAY = [
  {
    title: "In an emergency",
    detail:
      "Hold the SOS button for 3 seconds. Your circle is alerted with the live location, and the device calls your first SOS contact so the wearer can speak.",
  },
  {
    title: "As a simple phone",
    detail:
      "Hold green to call contact 1, hold red to call contact 2. A quick green press answers an incoming call, a quick red press ends it.",
  },
  {
    title: "Battery, out loud",
    detail:
      "A quick press of the SOS button speaks the battery level, for a wearer who cannot read a screen. peja also warns you in the app before it runs flat.",
  },
  {
    title: "Switching it off",
    detail:
      "Press and hold the green call button first, then hold the side button immediately after for about 5 seconds. Two buttons on purpose, so a pocket cannot switch it off.",
  },
  {
    title: "On the map",
    detail:
      "It reports its position while moving and rests when still. That is what keeps the battery alive for days rather than hours.",
  },
] as const;

const LEDS = [
  { color: "#22c55e", label: "Green, slow blink", meaning: "Network is fine." },
  { color: "#22c55e", label: "Green, fast blink", meaning: "Has signal, still connecting to peja." },
  { color: "#22c55e", label: "Green, stays on", meaning: "SIM problem or no network. Check the SIM." },
  { color: "#3b82f6", label: "Blue, slow blink", meaning: "GPS is locked. Location is accurate." },
  { color: "#3b82f6", label: "Blue, fast blink", meaning: "Looking for GPS. Step outside." },
  { color: "#ef4444", label: "Red, stays on", meaning: "Charging." },
] as const;

// Numbered chip pinned onto the illustration.


function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-dark-500 mb-4">
      {children}
    </h2>
  );
}

export function BeaconFirstRunManual({
  onDone,
  onExit,
}: {
  onDone: () => void;
  onExit: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  // Latches: once the reader has been to the bottom, resizing or scrolling
  // back up must not lock the button again.
  const [reachedEnd, setReachedEnd] = useState(false);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= END_SLACK_PX) {
      // Everything fits without scrolling (tablets, desktop). Nothing to gate.
      setProgress(1);
      setReachedEnd(true);
      return;
    }
    setProgress(Math.min(1, el.scrollTop / max));
    if (el.scrollTop >= max - END_SLACK_PX) setReachedEnd(true);
  }, []);

  useEffect(() => {
    // Measure once after layout so a short viewport unlocks immediately.
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  return (
    <div className="fixed inset-0 z-[60] bg-dark-950 flex flex-col">
      {/* reading progress, the only chrome on the page */}
      <div className="absolute top-0 left-0 right-0 h-[2px] z-20 bg-[var(--hairline)]">
        <div
          className="h-full bg-primary-500"
          style={{ width: `${progress * 100}%`, transition: "width 120ms linear" }}
        />
      </div>

      <div
        ref={scrollRef}
        onScroll={measure}
        className="flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="max-w-md mx-auto px-7 pb-10">
          {/* top bar: just a way out */}
          <div
            className="flex items-center -ml-3"
            style={{ paddingTop: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 12px) + 8px)" }}
          >
            <button
              onClick={onExit}
              aria-label="Back"
              className="p-2.5 rounded-full text-dark-400 active:scale-[0.97] transition-transform"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>

          {/* hero */}
          <header className="pt-6 pb-12 text-center">
            <p className="beacon-accent-text text-[12px] font-semibold uppercase tracking-[0.3em] mb-3">
              peja Beacon
            </p>
            <h1 className="text-[2rem] leading-tight font-bold text-dark-50 mb-3">
              Before you begin
            </h1>
            <p className="text-[15px] text-dark-400 leading-relaxed">
              Five minutes of reading now saves an hour of guessing later.
              This page is everything you and the wearer need to know.
            </p>
          </header>

          {/* the device */}
          <section className="pb-12">
            <BeaconIllustration />
            <ol className="mt-10 space-y-4">
              {PARTS.map((p) => (
                <li key={p.n} className="flex gap-3.5">
                  <span className="shrink-0 w-[18px] h-[18px] mt-0.5 rounded-full bg-primary-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {p.n}
                  </span>
                  <p className="text-sm text-dark-300 leading-relaxed">
                    <span className="font-semibold text-dark-100">{p.name}.</span>{" "}
                    {p.detail}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <hr className="border-0 h-px bg-[var(--hairline)] mb-12" />

          {/* prerequisites */}
          <section className="pb-12">
            <SectionTitle>Before you set up</SectionTitle>
            <p className="text-sm text-dark-400 leading-relaxed mb-6">
              The Beacon has no screen and no settings. Everything it needs, it
              needs before pairing starts. Have these four things ready.
            </p>
            <div className="space-y-5">
              {BEFORE_YOU_BEGIN.map((item, i) => (
                <div key={item.title} className="flex gap-4">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-[var(--soft-surface)] text-dark-200 text-[12px] font-semibold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-dark-100 mb-0.5">{item.title}</p>
                    <p className="text-sm text-dark-400 leading-relaxed">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-0 h-px bg-[var(--hairline)] mb-12" />

          {/* setup */}
          <section className="pb-12">
            <SectionTitle>Setting it up</SectionTitle>
            <div className="space-y-5">
              {SETUP_STEPS.map((s, i) => (
                <div key={s.title} className="flex gap-4">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-primary-600 text-white text-[12px] font-semibold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-dark-100 mb-0.5">{s.title}</p>
                    <p className="text-sm text-dark-400 leading-relaxed">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-0 h-px bg-[var(--hairline)] mb-12" />

          {/* daily use */}
          <section className="pb-12">
            <SectionTitle>Every day</SectionTitle>
            <div className="space-y-5">
              {EVERY_DAY.map((item) => (
                <div key={item.title}>
                  <p className="text-[15px] font-semibold text-dark-100 mb-0.5">{item.title}</p>
                  <p className="text-sm text-dark-400 leading-relaxed">{item.detail}</p>
                </div>
              ))}
            </div>
          </section>

          <hr className="border-0 h-px bg-[var(--hairline)] mb-12" />

          {/* lights */}
          <section className="pb-12">
            <SectionTitle>Reading the light</SectionTitle>
            <p className="text-sm text-dark-400 leading-relaxed mb-4">
              The status light sits on the bottom edge of the device.
            </p>
            <div className="rounded-2xl border border-[var(--hairline)] divide-y divide-[var(--hairline)] overflow-hidden">
              {LEDS.map((l) => (
                <div key={l.label} className="flex items-center gap-3.5 px-4 py-3">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: l.color, boxShadow: `0 0 8px ${l.color}` }}
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-dark-100">{l.label}</p>
                    <p className="text-[13px] text-dark-400">{l.meaning}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-dark-500 mt-3">
              Press the green and red button to switch which light is showing.
            </p>
          </section>

          {/* closing thought, so the end of the page feels like an end */}
          <section className="pb-6 text-center">
            <p className="text-sm text-dark-400 leading-relaxed">
              Keep it charged, keep airtime on the SIM, and keep it concealed on
              the wearer. Fabric does not block GPS, so under clothing is fine.
              A safety device that can be seen can be taken. That is the whole
              job.
            </p>
          </section>
        </div>
      </div>

      {/* pinned footer */}
      <div
        className="shrink-0 px-7 pt-3 border-t border-[var(--hairline)] bg-dark-950"
        style={{ paddingBottom: "calc(max(var(--app-bottom-inset, env(safe-area-inset-bottom, 0px)), 12px) + 8px)" }}
      >
        <button
          onClick={() => reachedEnd && onDone()}
          disabled={!reachedEnd}
          className="w-full max-w-md mx-auto block py-3.5 rounded-2xl text-[15px] font-semibold transition-colors duration-300 active:scale-[0.97] bg-primary-600 text-white disabled:bg-[var(--soft-surface)] disabled:text-dark-500"
        >
          {reachedEnd ? "Continue" : "Read to the end to continue"}
        </button>
      </div>
    </div>
  );
}
