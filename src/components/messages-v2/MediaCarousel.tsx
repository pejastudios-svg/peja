"use client";

// Fullscreen carousel viewer for chat media.
//
// Single component that replaces what used to be three separate
// lightboxes (single-image, single-video, multi-media bundle).
// Items can mix image and video — the slide renders the right
// element per type. The page only owns one piece of viewer state
// instead of three.
//
// Navigation:
//   • Prev / Next arrow buttons (hidden if items.length === 1).
//   • Horizontal swipe gesture (touch).
//   • Click on the dark backdrop closes; clicks on the slide /
//     controls don't bubble up.
//
// We re-mount the slide element on index change (via `key={index}`)
// so a video that was mid-play resets when navigating away. The
// alternative (a single <VideoPlayer> driven by changing `src`)
// would keep the old time/speed state and play whichever slide
// was visible when the user opens the carousel.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { VideoPlayer } from "./VideoPlayer";

export interface CarouselItem {
  url: string;
  type: "image" | "video";
  posterUrl?: string;
  fileName?: string;
}

interface Props {
  items: CarouselItem[];
  initialIndex?: number;
  onClose: () => void;
}

// Pixels of horizontal travel needed to commit a swipe to the
// next / previous slide. Anything shorter is treated as a tap.
const SWIPE_THRESHOLD = 50;

export function MediaCarousel({ items, initialIndex = 0, onClose }: Props) {
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex, items.length - 1))
  );
  const swipeStartX = useRef<number | null>(null);

  const goPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => (i < items.length - 1 ? i + 1 : i));
  }, [items.length]);

  // Keyboard nav. Useful on web, no-op on mobile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, onClose]);

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    swipeStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartX.current;
    swipeStartX.current = null;
    if (start === null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const dx = end - start;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx > 0) goPrev();
    else goNext();
  };

  if (items.length === 0) return null;
  const current = items[index];
  const showArrows = items.length > 1;

  return (
    <div
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>

      {items.length > 1 && (
        <div className="absolute top-4 left-4 z-10 text-white text-sm tabular-nums bg-white/10 rounded-full px-3 py-1">
          {index + 1} / {items.length}
        </div>
      )}

      {showArrows && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          disabled={index === 0}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-default"
          aria-label="Previous"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {showArrows && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          disabled={index === items.length - 1}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-default"
          aria-label="Next"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      <div
        key={index}
        onClick={(e) => e.stopPropagation()}
        className="relative max-w-full max-h-full flex items-center justify-center"
      >
        {current.type === "video" ? (
          <VideoPlayer
            src={current.url}
            poster={current.posterUrl}
            autoPlay
          />
        ) : (
          <img
            src={current.url}
            alt={current.fileName || ""}
            className="max-w-full max-h-full object-contain"
          />
        )}
      </div>
    </div>
  );
}
