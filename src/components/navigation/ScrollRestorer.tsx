"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

/**
 * ScrollRestorer
 *
 * Rock-solid scroll position saving and restoration.
 *
 * How it works:
 * 1. Scroll listener saves position on every scroll event (always up to date)
 * 2. On pathname change, we ONLY restore — never save (scrollY is already 0 by then)
 * 3. MutationObserver + polling waits for content to render before restoring
 * 4. Modal paths are ignored
 * 5. Non-scrolling pages (map, messages/[id], watch) don't hijack the listener
 * 6. During restoration, we block Next.js's own scrollTo(0,0) calls
 *
 * Critical insight: By the time React's useEffect cleanup or the new pathname
 * effect runs, Next.js has already unmounted the old page and scrollY is 0.
 * So we NEVER save scrollY during transitions — only during live scroll events.
 */

// Module-level storage — survives re-mounts
const positions = new Map<string, number>();

// Track which path is currently active for the scroll listener
let currentListeningPath: string | null = null;

// Flag to block Next.js scrollTo(0,0) during our restoration
let blockScrollToZero = false;

const MODAL_PATH_PATTERNS = [
  /^\/post\//, // post detail modal
  /^\/create$/, // create overlay
  /^\/profile\/edit$/, // edit profile overlay
  /^\/become-guardian$/, // become guardian overlay
  /^\/emergency-contacts$/, // emergency contacts modal
  /^\/help$/, // help modal
  /^\/privacy$/, // privacy modal
  /^\/terms$/, // terms modal
];

function isModalPath(pathname: string): boolean {
  return MODAL_PATH_PATTERNS.some((p) => p.test(pathname));
}

/**
 * Pages that use fixed/full-screen layouts and do NOT scroll the window.
 * For these pages:
 * - We do NOT update currentListeningPath (so the scroll listener keeps
 *   saving for the previous scrollable page)
 * - We do NOT try to save window.scrollY when leaving (it's always 0)
 * - We do NOT try to restore scroll when arriving (nothing to restore)
 */
const NON_SCROLLING_PATH_PATTERNS = [
  /^\/map$/, // map page — full screen fixed layout
  /^\/messages\/[^/]+$/, // messages/[id] — fixed chat layout
  /^\/watch$/, // watch page — full screen reels
];

function isNonScrollingPath(pathname: string): boolean {
  return NON_SCROLLING_PATH_PATTERNS.some((p) => p.test(pathname));
}

// Exported so pages can manually save if needed
export function saveScrollPosition(pathname: string, y: number) {
  positions.set(pathname, y);
}

export function getSavedScrollPosition(pathname: string): number {
  return positions.get(pathname) ?? 0;
}

// Single global scroll listener — always active, saves for currentListeningPath
function handleGlobalScroll() {
  if (!currentListeningPath) return;
  const y = window.scrollY;
  // Only save non-zero values to prevent overwriting good positions
  // during page transitions when scrollY briefly becomes 0
  if (y > 0) {
    positions.set(currentListeningPath, y);
  }
}

// Patch window.scrollTo to block Next.js's automatic scroll-to-top during restoration
if (typeof window !== "undefined") {
  window.addEventListener("scroll", handleGlobalScroll, { passive: true });

  const originalScrollTo = window.scrollTo.bind(window);

  window.scrollTo = function (...args: any[]) {
    // Detect scrollTo(0, 0) or scrollTo({ top: 0 }) calls
    if (blockScrollToZero) {
      let isScrollToZero = false;

      if (args.length === 2 && args[0] === 0 && args[1] === 0) {
        isScrollToZero = true;
      } else if (args.length === 1 && typeof args[0] === "object") {
        const opts = args[0];
        if ((opts.top === 0 || opts.top === undefined) && (opts.left === 0 || opts.left === undefined)) {
          isScrollToZero = true;
        }
      }

      if (isScrollToZero) {
        // Block this call — Next.js is trying to scroll to top but we want to restore
        return;
      }
    }

    return originalScrollTo(...args);
  } as typeof window.scrollTo;
}

export function ScrollRestorer() {
  const pathname = usePathname();
  const prevPathRef = useRef<string | null>(null);
  const restoringRef = useRef(false);
  const observerRef = useRef<MutationObserver | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const blockTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup function for restoration watchers
  const cleanupRestoration = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (blockTimerRef.current) {
      clearTimeout(blockTimerRef.current);
      blockTimerRef.current = null;
    }
    restoringRef.current = false;
    blockScrollToZero = false;
  }, []);

  // Attempt to restore scroll, returns true if successful
  const tryRestore = useCallback((targetY: number): boolean => {
    if (targetY <= 0) {
      return true;
    }

    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll >= targetY - 50) {
      // Use the original scrollTo behavior (our patch won't block non-zero targets)
      window.scrollTo(0, targetY);
      return true;
    }

    return false;
  }, []);

  // Start scroll restoration with retry logic
  const restoreScroll = useCallback(
    (targetY: number) => {
      if (targetY <= 0) {
        return;
      }

      // Block Next.js scrollTo(0,0) calls while we're restoring
      blockScrollToZero = true;
      restoringRef.current = true;

      // Safety: unblock after 2 seconds no matter what
      blockTimerRef.current = setTimeout(() => {
        blockScrollToZero = false;
      }, 2000);

      // Immediate attempt
      if (tryRestore(targetY)) {
        restoringRef.current = false;
        // Keep blocking for a short while — Next.js may scrollTo(0,0) after a tick
        setTimeout(() => {
          blockScrollToZero = false;
        }, 200);
        return;
      }

      let attempts = 0;
      const maxAttempts = 50;

      const attemptRestore = () => {
        attempts++;
        if (attempts > maxAttempts) {
          window.scrollTo(0, targetY);
          cleanupRestoration();
          return;
        }

        if (tryRestore(targetY)) {
          // Keep blocking briefly after successful restore
          setTimeout(() => {
            blockScrollToZero = false;
          }, 200);
          cleanupRestoration();
        }
      };

      observerRef.current = new MutationObserver(() => {
        attemptRestore();
      });

      observerRef.current.observe(document.body, {
        childList: true,
        subtree: true,
      });

      const poll = () => {
        if (!restoringRef.current) return;
        attemptRestore();
        if (restoringRef.current) {
          pollTimerRef.current = setTimeout(poll, 100);
        }
      };
      pollTimerRef.current = setTimeout(poll, 50);
    },
    [tryRestore, cleanupRestoration]
  );

  // Update which path the global scroll listener saves for
  useEffect(() => {
    // Modal paths: don't touch anything
    if (isModalPath(pathname)) return;

    // Non-scrolling pages (map, messages/[id], watch):
    // Do NOT update currentListeningPath — keep saving scroll for the
    // previous scrollable page so we don't lose it
    if (isNonScrollingPath(pathname)) return;

    // Scrollable page: update the listening path
    // The scroll listener already saved the position for the old path
    // via live scroll events, so we don't need to save here
    currentListeningPath = pathname;
  }, [pathname]);

  // Handle pathname changes — ONLY restore, never save
  useEffect(() => {
    const prevPath = prevPathRef.current;
    prevPathRef.current = pathname;

    // First render
    if (prevPath === null) {
      if (!isModalPath(pathname) && !isNonScrollingPath(pathname)) {
        const saved = positions.get(pathname);
        if (saved && saved > 0) {
          restoreScroll(saved);
        }
      }
      return;
    }

    // Navigating TO a modal — don't touch anything
    if (isModalPath(pathname)) {
      return;
    }

    // Navigating FROM a modal back to a real page — don't touch scroll
    if (prevPath && isModalPath(prevPath)) {
      return;
    }

    // Navigating TO a non-scrolling page — no restoration needed
    if (isNonScrollingPath(pathname)) {
      cleanupRestoration();
      return;
    }

    // Navigating between real scrollable pages (or FROM a non-scrolling page)
    cleanupRestoration();

    const saved = positions.get(pathname);
    if (saved && saved > 0) {
      restoreScroll(saved);
    }

    return () => {
      cleanupRestoration();
    };
  }, [pathname, restoreScroll, cleanupRestoration]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRestoration();
    };
  }, [cleanupRestoration]);

  return null;
}