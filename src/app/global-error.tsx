"use client";

import { useEffect, useState } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Read the saved theme directly — global-error.tsx mounts outside ThemeProvider
  // so we can't use the context, and no globals.css is loaded here.
  const [isLight, setIsLight] = useState(false);
  useEffect(() => {
    try {
      setIsLight(localStorage.getItem("peja-theme") === "light");
    } catch {}
  }, []);

  useEffect(() => {
    console.error("[Peja] Global error:", error);
  }, [error]);

  const palette = isLight
    ? { bg: "#ffffff", fg: "#0c0a14", sub: "#52525b", border: "rgba(0,0,0,0.1)" }
    : { bg: "#0c0818", fg: "#ffffff", sub: "#94a3b8", border: "rgba(255,255,255,0.1)" };

  return (
    <html>
      <body
        style={{
          margin: 0,
          background: palette.bg,
          color: palette.fg,
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "24px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "rgba(124, 58, 237, 0.15)",
              border: "2px solid rgba(139, 92, 246, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <img
              src="https://plastic-lime-elzghqehop.edgeone.app/peja%20logo%20SINGLE.png"
              alt="Peja"
              style={{ width: 40, height: 40, objectFit: "contain" }}
            />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 14, color: palette.sub, marginBottom: 24, lineHeight: 1.5 }}>
            We hit an unexpected issue. This is usually temporary.
          </p>
          <button
            onClick={reset}
            style={{
              width: "100%",
              padding: "14px 24px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
              color: "white",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              marginBottom: 12,
            }}
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.replace("/")}
            style={{
              width: "100%",
              padding: "12px 24px",
              borderRadius: 12,
              border: `1px solid ${palette.border}`,
              background: "transparent",
              color: palette.sub,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Go Home
          </button>
        </div>
      </body>
    </html>
  );
}