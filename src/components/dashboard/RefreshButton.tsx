"use client";

import { RefreshCw } from "lucide-react";

// Icon-only refresh control for the admin pages. The icon spins while
// `loading` is true (bind it to the page's fetch state) and the button is
// disabled meanwhile so it can't be spammed. No glow, hairline border.
export default function RefreshButton({
  onClick,
  loading = false,
  className = "",
}: {
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label="Refresh"
      className={`inline-flex items-center justify-center w-9 h-9 rounded-full border border-white/[0.07] text-dark-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
    </button>
  );
}
