"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export function PejaLoadingScreen() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 300);
    const t2 = setTimeout(() => setPhase(2), 700);
    const t3 = setTimeout(() => setPhase(3), 1100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#020617] relative overflow-hidden">
      {/* Background grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.1,
          backgroundImage:
            "linear-gradient(rgba(167,139,250,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(167,139,250,0.3) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(circle at 50% 50%, black 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 50%, black 0%, transparent 70%)",
        }}
      />

      {/* Ambient glow */}
      <div
        className="absolute"
        style={{
          width: 350,
          height: 350,
          background:
            "radial-gradient(circle, rgba(124,58,237,0.15) 0%, rgba(34,197,94,0.08) 30%, rgba(59,130,246,0.06) 50%, transparent 70%)",
          animation: "peja-load-ambient 2.5s ease-in-out infinite",
        }}
      />

      {/* Logo container */}
      <div
        className="relative"
        style={{
          width: 160,
          height: 160,
          animation: phase >= 1 ? "peja-load-float 3s ease-in-out infinite" : "none",
        }}
      >
        {/* Outer scanning ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: -16,
            border: "2px solid transparent",
            borderTopColor: "rgba(34,197,94,0.5)",
            borderRightColor: "rgba(59,130,246,0.3)",
            borderBottomColor: "rgba(234,179,8,0.3)",
            borderLeftColor: "rgba(192,38,211,0.3)",
            animation: "peja-load-spin 2.5s linear infinite",
            opacity: phase >= 1 ? 1 : 0,
            transition: "opacity 0.4s ease-out",
          }}
        />

        {/* Glow ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: -8,
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow:
              "0 0 40px rgba(34,197,94,0.15), 0 0 40px rgba(59,130,246,0.1), 0 0 40px rgba(234,179,8,0.1)",
            animation: phase >= 1 ? "peja-load-pulse-ring 2s ease-in-out infinite" : "none",
            opacity: phase >= 1 ? 1 : 0,
            transition: "opacity 0.5s ease-out",
          }}
        />

        {/* Actual PEJA Logo */}
        <div
          className="w-full h-full relative z-10 flex items-center justify-center"
          style={{
            opacity: phase >= 0 ? 1 : 0,
            transition: "opacity 0.4s ease-out",
            animation: phase >= 1 ? "peja-logo-pulse 2s ease-in-out infinite" : "none",
            filter: phase >= 2
              ? "drop-shadow(0 0 12px rgba(34,197,94,0.5)) drop-shadow(0 0 12px rgba(59,130,246,0.4)) drop-shadow(0 0 12px rgba(234,179,8,0.4)) drop-shadow(0 0 25px rgba(192,38,211,0.3))"
              : "drop-shadow(0 0 2px rgba(255,255,255,0.1))",
          }}
        >
          <Image
            src="https://plastic-lime-elzghqehop.edgeone.app/peja%20logo%20SINGLE.png"
            alt="PEJA Logo"
            width={160}
            height={160}
            className="w-full h-full object-contain"
            priority
          />
        </div>
      </div>

      {/* PEJA text */}
      <div
        className="mt-8 relative"
        style={{
          opacity: phase >= 3 ? 1 : 0,
          transform: phase >= 3 ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
        }}
      >
        <span
          className="text-2xl font-bold tracking-[0.25em]"
          style={{
            background: "linear-gradient(135deg, #c4b5fd 0%, #8b5cf6 50%, #7c3aed 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            filter: "drop-shadow(0 0 20px rgba(139,92,246,0.5))",
            animation: phase >= 3 ? "peja-load-text-glow 2s ease-in-out infinite" : "none",
          }}
        >
          PEJA
        </span>
      </div>

      {/* Loading dots */}
      <div
        className="flex gap-2 mt-5"
        style={{
          opacity: phase >= 3 ? 1 : 0,
          transition: "opacity 0.4s ease-out 0.2s",
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-full"
            style={{
              width: 6,
              height: 6,
              background:
                i === 0
                  ? "#22c55e"
                  : i === 1
                  ? "#3b82f6"
                  : "#c026d3",
              boxShadow: `0 0 8px ${
                i === 0
                  ? "rgba(34,197,94,0.6)"
                  : i === 1
                  ? "rgba(59,130,246,0.6)"
                  : "rgba(192,38,211,0.6)"
              }`,
              animation: `peja-load-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}