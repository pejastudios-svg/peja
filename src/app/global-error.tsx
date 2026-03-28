"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Peja] Global error:", error);
  }, [error]);

  return (
    <html>
      <body
        style={{
          margin: 0,
          background: "#0c0818",
          color: "white",
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
          <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 24, lineHeight: 1.5 }}>
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
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "#94a3b8",
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