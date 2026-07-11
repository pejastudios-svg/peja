"use client";

import { useEffect } from "react";

/**
 * AirPods-style pairing success: ring burst, then the circle and check
 * draw themselves in, then the copy settles up from below.
 */
export function BeaconSuccess({
  deviceName,
  onContinue,
}: {
  deviceName: string;
  onContinue: () => void;
}) {
  useEffect(() => {
    if (navigator.vibrate) navigator.vibrate([15, 70, 30]);
  }, []);

  return (
    <div className="pt-16 text-center space-y-8">
      <div className="relative mx-auto w-32 h-32">
        <div className="absolute inset-0 rounded-full border-2 border-green-400/50 beacon-burst" />
        <svg viewBox="0 0 120 120" className="beacon-pop w-32 h-32">
          <circle
            cx="60" cy="60" r="52"
            fill="rgba(34,197,94,0.08)"
            stroke="rgb(34,197,94)"
            strokeWidth="4"
            strokeLinecap="round"
            className="beacon-draw-circle"
            style={{
              strokeDasharray: 327,
              strokeDashoffset: 327,
              transformOrigin: "center",
              transform: "rotate(-90deg)",
            }}
          />
          <path
            d="M38 62 L53 77 L84 45"
            fill="none"
            stroke="rgb(74,222,128)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="beacon-draw-check"
            style={{ strokeDasharray: 70, strokeDashoffset: 70 }}
          />
        </svg>
      </div>

      <div className="space-y-2">
        <h2
          className="beacon-stagger text-2xl font-bold text-dark-50"
          style={{ animationDelay: "0.75s" }}
        >
          Connected
        </h2>
        <p
          className="beacon-stagger text-dark-400 text-[15px] px-6 leading-relaxed"
          style={{ animationDelay: "0.85s" }}
        >
          {deviceName} is live and watching over you. Hold its SOS button any
          time you need help.
        </p>
      </div>

      <button
        onClick={onContinue}
        className="beacon-stagger w-full py-4 rounded-2xl bg-primary-600 text-white font-semibold active:scale-[0.98] transition-transform"
        style={{ animationDelay: "1s" }}
      >
        Open my Beacon
      </button>
    </div>
  );
}
