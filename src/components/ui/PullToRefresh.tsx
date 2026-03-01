"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
}

export function PullToRefresh({ onRefresh, children, className = "" }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const THRESHOLD = 70;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 5 || refreshing) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling.current || refreshing) return;
      if (window.scrollY > 5) {
        pulling.current = false;
        setPullDistance(0);
        return;
      }

      const diff = e.touches[0].clientY - startY.current;
      if (diff > 10) {
        e.preventDefault();
        setPullDistance(Math.min(diff * 0.4, 120));
      } else if (diff < -5) {
        pulling.current = false;
        setPullDistance(0);
      }
    };

    const onTouchEnd = async () => {
      if (!pulling.current) return;
      pulling.current = false;

      const dist = pullDistance;
      if (dist >= THRESHOLD && !refreshing) {
        setRefreshing(true);
        setPullDistance(THRESHOLD);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    // CRITICAL: { passive: false } allows e.preventDefault() to work on Android
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [refreshing, pullDistance, onRefresh]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);

  return (
    <div ref={containerRef} className={className}>
      {pullDistance > 0 && (
        <div
          className="flex items-center justify-center pointer-events-none fixed top-0 left-0 right-0 z-50"
          style={{
            height: `${pullDistance}px`,
            paddingTop: "env(safe-area-inset-top, 0px)",
          }}
        >
          <div
            style={{
              opacity: progress,
              transform: `rotate(${progress * 360}deg)`,
            }}
          >
            <Loader2
              className={`w-6 h-6 text-primary-400 ${refreshing ? "animate-spin" : ""}`}
            />
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
