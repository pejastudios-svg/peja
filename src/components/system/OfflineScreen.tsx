"use client";

import { useState } from "react";

interface OfflineScreenProps {
  onRetry: () => void;
}

export function OfflineScreen({ onRetry }: OfflineScreenProps) {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<"offline" | "checking" | "still-offline">("offline");

  const handleRetry = async () => {
    if (checking) return;
    setChecking(true);
    setStatus("checking");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      await fetch("https://peja.vercel.app/", {
        method: "HEAD",
        cache: "no-store",
        mode: "no-cors",
        signal: controller.signal,
      });

      clearTimeout(timeout);
      onRetry();
    } catch {
      setStatus("still-offline");
      setChecking(false);
      setTimeout(() => setStatus("offline"), 3000);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #020617 0%, #0f172a 50%, #1e1033 100%)" }}
    >
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
          background: "radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 70%)",
          animation: "peja-load-ambient 2.5s ease-in-out infinite",
        }}
      />

      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-sm">
        {/* Logo */}
        <div className="relative w-24 h-24 mb-8">
          <div
            className="absolute rounded-full"
            style={{
              inset: -20,
              background: "radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 70%)",
              animation: "peja-load-ambient 3s ease-in-out infinite",
            }}
          />
          <img
            src="/peja-logo.png"
            alt="Peja"
            className="relative z-10 w-full h-full object-contain"
            style={{
              filter: "drop-shadow(0 0 10px rgba(124,58,237,0.3)) grayscale(0.3) brightness(0.8)",
              animation: "peja-load-float 3s ease-in-out infinite",
            }}
          />
        </div>

        {/* Wifi off icon */}
        <div className="w-14 h-14 mb-6 relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#64748b"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-full h-full"
            style={{ animation: "peja-wifi-fade 2s ease-in-out infinite" }}
          >
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <circle cx="12" cy="20" r="1" fill="#64748b" />
          </svg>
          {/* Red slash */}
          <div
            className="absolute top-1/2 left-1/2 rounded-sm"
            style={{
              width: 56,
              height: 3,
              background: "linear-gradient(90deg, transparent, #ef4444, #ef4444, transparent)",
              transform: "translate(-50%, -50%) rotate(-45deg)",
              boxShadow: "0 0 10px rgba(239, 68, 68, 0.4)",
            }}
          />
        </div>

        {/* Text */}
        <h1 className="text-xl font-bold text-dark-100 mb-2">No Internet Connection</h1>
        <p className="text-sm text-dark-500 leading-relaxed mb-8">
          Please check your Wi-Fi or mobile data and try again. Peja needs an internet connection to keep you safe.
        </p>

        {/* Retry button */}
        <button
          onClick={handleRetry}
          disabled={checking}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-white transition-all active:scale-95"
          style={{
            background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
            boxShadow: "0 4px 20px rgba(124, 58, 237, 0.35)",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
            style={{ animation: checking ? "peja-load-spin 1s linear infinite" : "none" }}
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {checking ? "Checking..." : "Retry"}
        </button>

        {/* Status indicator */}
        <div
          className="mt-6 flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium"
          style={{
            background:
              status === "checking"
                ? "rgba(234, 179, 8, 0.1)"
                : status === "still-offline"
                ? "rgba(239, 68, 68, 0.15)"
                : "rgba(239, 68, 68, 0.1)",
            border: `1px solid ${
              status === "checking"
                ? "rgba(234, 179, 8, 0.2)"
                : "rgba(239, 68, 68, 0.2)"
            }`,
            color:
              status === "checking"
                ? "#facc15"
                : status === "still-offline"
                ? "#f87171"
                : "#f87171",
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background:
                status === "checking" ? "#eab308" : "#ef4444",
              animation: "peja-status-blink 1.5s ease-in-out infinite",
            }}
          />
          {status === "checking"
            ? "Checking connection..."
            : status === "still-offline"
            ? "Still offline"
            : "Offline"}
        </div>
      </div>
    </div>
  );
}