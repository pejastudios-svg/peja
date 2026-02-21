"use client";

// This hook is now a no-op. Scroll restoration is handled globally
// by the ScrollRestorer component in layout.tsx.
// Keeping this file so existing imports don't break.
export function useScrollRestore(_key?: string) {
  // No-op — handled by ScrollRestorer
}