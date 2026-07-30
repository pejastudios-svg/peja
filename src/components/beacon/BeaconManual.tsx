"use client";

import { useState } from "react";
import { BatteryCharging, ChevronRight, Info, Phone, PhoneOff, Power, Siren } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

// In-app manual for the Beacon (P02L). Written from the device's own user
// guide, but in plain words for the person who will actually wear it and
// the family member setting it up. Paper manuals get lost; this one is
// always in the pocket of whoever paired the device.

interface Row {
  icon: React.ReactNode;
  label: string;
  short: string;
  long: string;
}

const BUTTONS: Row[] = [
  {
    icon: <Siren className="w-4.5 h-4.5 text-red-400" />,
    label: "Red SOS button (top)",
    short: "Speaks the battery level out loud.",
    long: "Hold for 3 seconds to raise an emergency alert. Your circle is notified with the location, and the device calls your first SOS contact.",
  },
  {
    icon: <Phone className="w-4.5 h-4.5 text-green-400" />,
    label: "Green button (left)",
    short: "Answers an incoming call.",
    long: "Hold for 3 seconds to call contact 1.",
  },
  {
    icon: <PhoneOff className="w-4.5 h-4.5 text-red-400" />,
    label: "Red button (right)",
    short: "Ends a call.",
    long: "Hold for 3 seconds to call contact 2.",
  },
];

const LEDS = [
  { color: "#22c55e", label: "Green, slow blink", meaning: "Network is fine." },
  { color: "#22c55e", label: "Green, fast blink", meaning: "Has signal, still connecting to peja." },
  { color: "#22c55e", label: "Green, stays on", meaning: "SIM problem or no network. Check the SIM." },
  { color: "#3b82f6", label: "Blue, slow blink", meaning: "GPS is locked. Location is accurate." },
  { color: "#3b82f6", label: "Blue, fast blink", meaning: "Looking for GPS. Step outside." },
  { color: "#ef4444", label: "Red, stays on", meaning: "Charging." },
];

export function BeaconManual() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-dark-800/50 border border-dark-700 active:scale-[0.985] transition-transform"
      >
        <div className="w-9 h-9 rounded-full bg-primary-500/15 flex items-center justify-center shrink-0">
          <Info className="beacon-accent-text w-4.5 h-4.5" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-dark-100">How the Beacon works</p>
          <p className="text-xs text-dark-500">Buttons, lights, charging and care</p>
        </div>
        <ChevronRight className="w-4 h-4 text-dark-500 shrink-0" />
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="How the Beacon works">
        <div className="space-y-6">
          {/* buttons */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-dark-500 mb-3">
              The buttons
            </p>
            <div className="space-y-2.5">
              {BUTTONS.map((b) => (
                <div key={b.label} className="rounded-2xl bg-dark-800/60 border border-dark-700 p-3.5">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-8 h-8 rounded-full bg-dark-700/70 flex items-center justify-center shrink-0">
                      {b.icon}
                    </div>
                    <p className="text-sm font-semibold text-dark-100">{b.label}</p>
                  </div>
                  <p className="text-xs text-dark-300 leading-relaxed">
                    <span className="font-semibold text-dark-200">Quick press:</span> {b.short}
                  </p>
                  <p className="text-xs text-dark-300 leading-relaxed mt-1">
                    <span className="font-semibold text-dark-200">Hold:</span> {b.long}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* power */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-dark-500 mb-3">
              Turning it on and off
            </p>
            <div className="rounded-2xl bg-dark-800/60 border border-dark-700 p-3.5 space-y-2">
              <div className="flex items-start gap-2.5">
                <Power className="beacon-ok-text w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-xs text-dark-300 leading-relaxed">
                  <span className="font-semibold text-dark-200">On:</span> hold the
                  side button for about 5 seconds, until the green light comes on or you
                  hear the startup tone. Then let go.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <Power className="beacon-bad-text w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-xs text-dark-300 leading-relaxed">
                  <span className="font-semibold text-dark-200">Off:</span> press and
                  hold the green call button first, then hold the side button for about
                  5 seconds. A voice plays as it shuts down. Two buttons on purpose, so
                  it cannot be switched off by accident in a pocket.
                </p>
              </div>
            </div>
          </section>

          {/* lights */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-dark-500 mb-3">
              What the lights mean
            </p>
            <div className="rounded-2xl bg-dark-800/60 border border-dark-700 divide-y divide-dark-700/70">
              {LEDS.map((l) => (
                <div key={l.label} className="flex items-center gap-3 p-3">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: l.color, boxShadow: `0 0 8px ${l.color}` }}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-dark-100">{l.label}</p>
                    <p className="text-xs text-dark-400">{l.meaning}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-dark-500 mt-2">
              Press the green button to switch which light is showing.
            </p>
          </section>

          {/* battery */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-dark-500 mb-3">
              Battery and charging
            </p>
            <div className="rounded-2xl bg-dark-800/60 border border-dark-700 p-3.5 space-y-2">
              <div className="flex items-start gap-2.5">
                <BatteryCharging className="beacon-accent-text w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-xs text-dark-300 leading-relaxed">
                  Charge with the USB cable. A full charge takes about 4 hours and the
                  light stays red while charging.
                </p>
              </div>
              <p className="text-xs text-dark-300 leading-relaxed">
                Press the red SOS button once and it will say the battery level out
                loud, useful for someone who cannot read a screen.
              </p>
              <p className="text-xs text-dark-300 leading-relaxed">
                The battery level also shows at the top of this screen, and turns red
                when it is running low. Charge it on a routine, the same way you would
                a phone, so it is never flat when it matters.
              </p>
            </div>
          </section>

          {/* first use */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-dark-500 mb-3">
              Getting the best from it
            </p>
            <div className="rounded-2xl bg-dark-800/60 border border-dark-700 p-3.5 space-y-2">
              <p className="text-xs text-dark-300 leading-relaxed">
                The first time you use it, take it outside for about 3 minutes so it can
                find GPS. After that it locks on much faster.
              </p>
              <p className="text-xs text-dark-300 leading-relaxed">
                Worn on the arm band or on the hanging rope works best. Deep inside a
                bag, both GPS and the speaker suffer.
              </p>
              <p className="text-xs text-dark-300 leading-relaxed">
                It sends its position while moving and rests when still, which is what
                keeps the battery alive for days rather than hours.
              </p>
            </div>
          </section>

          <button
            onClick={() => setOpen(false)}
            className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold active:scale-[0.98] transition-transform"
          >
            Got it
          </button>
        </div>
      </Modal>
    </>
  );
}
