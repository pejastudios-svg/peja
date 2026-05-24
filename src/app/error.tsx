"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("[Peja] Page error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--page-bg)" }}>
      <div className="text-center max-w-sm">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{
            background: "var(--soft-surface)",
            border: "2px solid var(--border-default)",
          }}
        >
          <img
            src="https://plastic-lime-elzghqehop.edgeone.app/peja%20logo%20SINGLE.png"
            alt="Peja"
            className="w-10 h-10 object-contain"
          />
        </div>
        <h2 className="text-xl font-bold text-dark-100 mb-2">Something went wrong</h2>
        <p className="text-sm text-dark-400 mb-6 leading-relaxed">
          We hit an unexpected issue. This is usually temporary.
        </p>
        <button
          onClick={reset}
          className="w-full py-3.5 rounded-xl font-semibold text-white mb-3"
          style={{
            background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
          }}
        >
          Try Again
        </button>
        <button
          onClick={() => router.push("/")}
          className="w-full py-3 rounded-xl text-sm font-medium text-dark-400 hover:text-dark-200"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          Go Home
        </button>
      </div>
    </div>
  );
}