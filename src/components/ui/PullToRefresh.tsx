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
  const currentPull = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const THRESHOLD = 50;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 5 || refreshing) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
      currentPull.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling.current || refreshing) return;
      if (window.scrollY > 5) {
        pulling.current = false;
        setPullDistance(0);
        currentPull.current = 0;
        return;
      }

      const diff = e.touches[0].clientY - startY.current;
      if (diff > 5) {
        e.preventDefault();
        // Less damping so it feels responsive
        const distance = Math.min(diff * 0.55, 130);
        currentPull.current = distance;
        setPullDistance(distance);
      } else if (diff < -5) {
        pulling.current = false;
        setPullDistance(0);
        currentPull.current = 0;
      }
    };

    const onTouchEnd = async () => {
      if (!pulling.current) return;
      pulling.current = false;

      const dist = currentPull.current;
      if (dist >= THRESHOLD && !refreshing) {
        setRefreshing(true);
        setPullDistance(40);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPullDistance(0);
          currentPull.current = 0;
        }
      } else {
        setPullDistance(0);
        currentPull.current = 0;
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [refreshing, onRefresh]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);

  return (
    <div ref={containerRef} className={className}>
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex items-center justify-center pointer-events-none fixed top-0 left-0 right-0 z-50"
          style={{
            height: `${Math.max(pullDistance, refreshing ? 40 : 0)}px`,
            transition: pulling.current ? "none" : "height 0.25s ease",
            paddingTop: "env(safe-area-inset-top, 0px)",
          }}
        >
          <div
            style={{
              opacity: refreshing ? 1 : progress,
              transform: refreshing ? "none" : `rotate(${progress * 360}deg)`,
              transition: pulling.current ? "none" : "all 0.25s ease",
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
