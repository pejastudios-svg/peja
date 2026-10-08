"use client";

import { Phone, PhoneOff } from "lucide-react";

// Pulled out of BeaconFirstRunManual so the locked teaser can render the
// same device behind its blur. One drawing, so the thing someone sees
// through the lock is exactly the thing they get after it.

function PartChip({ n, className }: { n: number; className: string }) {
  return (
    <span
      className={`absolute z-10 w-[18px] h-[18px] rounded-full bg-primary-600 text-white text-[10px] font-bold flex items-center justify-center shadow-md ${className}`}
      aria-hidden
    >
      {n}
    </span>
  );
}

// The device, drawn with plain CSS so it stays crisp at any size and in
// both themes. Deliberately literal: black body, red SOS, two white call
// buttons, brass side button on the left with the SIM tray above it,
// matching the photo in the pitch document. Two views, because the status
// light lives on the bottom edge where a front view cannot show it.
export function BeaconIllustration() {
  return (
    <figure className="mx-auto select-none m-0" aria-label="Illustration of the Beacon device, front and bottom views">
      {/* ── front view ── */}
      <div className="relative w-44 h-72 mx-auto">
        {/* lanyard loop */}
        <div
          className="absolute left-1/2 -translate-x-1/2 top-0 w-16 h-9 rounded-t-full border-[7px] border-b-0"
          style={{ borderColor: "#26262a" }}
        />
        {/* body */}
        <div
          className="absolute left-0 right-0 top-7 bottom-0 rounded-[2.4rem]"
          style={{
            background: "linear-gradient(160deg, #232327 0%, #0e0e11 55%, #050507 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -6px 16px rgba(0,0,0,0.6), 0 18px 40px rgba(0,0,0,0.35)",
          }}
        >
          {/* speaker holes, like the photo. The status light is NOT here,
              it is on the bottom edge, shown in the second view. */}
          <div className="absolute top-7 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-white/15" />
            <span className="w-1 h-1 rounded-full bg-white/15" />
            <span className="w-1 h-1 rounded-full bg-white/15" />
          </div>

          {/* SOS button */}
          <div
            className="absolute top-[22%] left-1/2 -translate-x-1/2 w-[4.4rem] h-[4.4rem] rounded-full flex items-center justify-center"
            style={{
              background: "radial-gradient(circle at 35% 30%, #f16a6a 0%, #dc2626 45%, #a51616 100%)",
              boxShadow:
                "inset 0 2px 4px rgba(255,255,255,0.35), inset 0 -4px 8px rgba(0,0,0,0.35), 0 4px 14px rgba(220,38,38,0.35)",
            }}
          >
            <span className="text-white font-extrabold tracking-widest text-sm">SOS</span>
          </div>

          {/* the two white call buttons, petal pair like the real device */}
          <div className="absolute top-[55%] left-1/2 -translate-x-1/2 flex gap-1.5">
            <div
              className="w-11 h-[4.6rem] flex items-center justify-center"
              style={{
                background: "linear-gradient(180deg, #ffffff 0%, #e8e8ec 100%)",
                borderRadius: "2.4rem 0.6rem 0.6rem 2.4rem / 3rem 0.6rem 0.6rem 3rem",
                boxShadow: "inset 0 1px 0 #fff, 0 2px 6px rgba(0,0,0,0.45)",
              }}
            >
              <Phone className="w-4.5 h-4.5" style={{ color: "#16a34a" }} />
            </div>
            <div
              className="w-11 h-[4.6rem] flex items-center justify-center"
              style={{
                background: "linear-gradient(180deg, #ffffff 0%, #e8e8ec 100%)",
                borderRadius: "0.6rem 2.4rem 2.4rem 0.6rem / 0.6rem 3rem 3rem 0.6rem",
                boxShadow: "inset 0 1px 0 #fff, 0 2px 6px rgba(0,0,0,0.45)",
              }}
            >
              <PhoneOff className="w-4.5 h-4.5" style={{ color: "#dc2626" }} />
            </div>
          </div>
        </div>

        {/* left edge: SIM tray above, brass side button below it */}
        <div
          className="absolute -left-[2px] top-[36%] w-[5px] h-8 rounded-full"
          style={{ background: "#2c2c31" }}
        />
        <div
          className="absolute -left-[3px] top-[52%] w-[7px] h-10 rounded-full"
          style={{ background: "linear-gradient(90deg, #d3aa5e, #93702f)" }}
        />

        {/* numbered callouts, sitting on their parts */}
        {/* 1: right edge of the SOS button */}
        <PartChip n={1} className="top-[27%] left-1/2 translate-x-[34px]" />
        {/* 2: left edge of the left call button */}
        <PartChip n={2} className="top-[63%] left-1/2 -translate-x-[54px]" />
        {/* 5: SIM tray, left edge, above the side button */}
        <PartChip n={5} className="top-[38%] -left-3" />
        {/* 3: side (power) button, left edge */}
        <PartChip n={3} className="top-[55%] -left-3" />
      </div>
      <figcaption className="mt-3 text-center text-[11px] uppercase tracking-[0.2em] text-dark-500">
        Front
      </figcaption>

      {/* ── bottom view: where the status light lives ── */}
      <div className="relative w-44 h-10 mx-auto mt-8">
        <div
          className="absolute inset-0 rounded-[1.1rem]"
          style={{
            background: "linear-gradient(180deg, #232327 0%, #0e0e11 70%, #050507 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -3px 8px rgba(0,0,0,0.6), 0 10px 24px rgba(0,0,0,0.3)",
          }}
        >
          {/* the status light window */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-[7px] rounded-full flex items-center justify-center"
            style={{ background: "#101013", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.8)" }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "#22c55e", boxShadow: "0 0 8px #22c55e" }}
            />
          </div>
        </div>
        {/* 4: the status light */}
        <PartChip n={4} className="top-1/2 -translate-y-1/2 left-1/2 translate-x-[30px]" />
      </div>
      <figcaption className="mt-3 text-center text-[11px] uppercase tracking-[0.2em] text-dark-500">
        Bottom
      </figcaption>
    </figure>
  );
}
