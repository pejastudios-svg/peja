"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react"; // <--- REMOVED X
import { Portal } from "@/components/ui/Portal";
import { InlineVideo } from "@/components/reels/InlineVideo";

export type MediaItem = { url: string; type: "image" | "video" };

export function ImageLightbox({
  isOpen,
  onClose,
  imageUrl,
  items,
  initialIndex = 0,
}: {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  items?: MediaItem[];
  initialIndex?: number;
  caption?: string | null;
}) {
  const mediaItems: MediaItem[] = useMemo(() => {
    if (items && items.length > 0) return items;
    if (imageUrl) return [{ url: imageUrl, type: "image" }];
    return [];
  }, [items, imageUrl]);

  const [index, setIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Drag State
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDragOffset(0);
      return;
    }

    const nextIndex = Math.min(Math.max(initialIndex, 0), Math.max(0, mediaItems.length - 1));
    setIndex(nextIndex);

    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const w = el.clientWidth || 1;
      el.scrollLeft = w * nextIndex;
    });
  }, [isOpen, initialIndex, mediaItems.length]);

  if (!isOpen || mediaItems.length === 0) return null;

  const close = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onClose();
  };

  const goTo = (next: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = Math.min(Math.max(next, 0), mediaItems.length - 1);
    const w = el.clientWidth || 1;
    el.scrollTo({ left: w * clamped, behavior: "smooth" });
    setIndex(clamped);
  };

  // --- Vertical Drag Logic ---
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      dragStartY.current = e.touches[0].clientY;
      setIsDragging(true);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    setDragOffset(dy);
  };

  const onTouchEnd = () => {
    dragStartY.current = null;
    setIsDragging(false);

    if (Math.abs(dragOffset) > 100) {
      onClose(); 
    } else {
      setDragOffset(0); 
    }
  };

  const bgOpacity = Math.max(0, 1 - Math.abs(dragOffset) / 400);

  return (
    <Portal>
      <div 
        className="fixed inset-0 z-[99999] flex items-center justify-center touch-none"
        onClick={close}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Dynamic Background */}
        <div 
          className="absolute inset-0 bg-black transition-opacity duration-100 ease-linear"
          style={{ opacity: bgOpacity }}
        />

        {/* Top bar (Fades out on drag) */}
        <div
          className={`absolute top-0 left-0 right-0 z-[100000] flex items-center justify-between px-4 transition-opacity duration-200 ${isDragging ? 'opacity-0' : 'opacity-100'}`}
          style={{ paddingTop: "calc(12px + env(safe-area-inset-top, 0px))", height: "56px" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Back Button (Left) */}
          <button
            type="button"
            onClick={close}
            className="p-2 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md"
            aria-label="Close"
          >
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>

          {/* Counter (Right) */}
          <div className="text-white/80 text-sm font-medium px-3 py-1 bg-black/40 rounded-full backdrop-blur-md">
            {mediaItems.length > 1 ? `${index + 1} / ${mediaItems.length}` : ""}
          </div>
        </div>

        {/* Draggable Carousel Container */}
        <div 
          className="absolute inset-0 transition-transform duration-200 ease-out"
          style={{ 
            transform: `translateY(${dragOffset}px)`,
            transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={scrollerRef}
            className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scroll-smooth"
            style={{ WebkitOverflowScrolling: "touch" }}
            onScroll={() => {
              const el = scrollerRef.current;
              if (!el) return;
              const w = el.clientWidth || 1;
              const newIndex = Math.round(el.scrollLeft / w);
              if (newIndex !== index) setIndex(newIndex);
            }}
          >
            {mediaItems.map((m, i) => (
              <div key={i} className="w-full h-full shrink-0 snap-center flex items-center justify-center p-2">
                {m.type === "video" ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <InlineVideo
                      src={m.url}
                      className="w-full h-full object-contain max-h-screen"
                      showExpand={false}
                      showMute={true}
                    />
                  </div>
                ) : (
                  <img 
                    src={m.url} 
                    alt="" 
                    className="w-full h-full object-contain max-h-screen pointer-events-none select-none" 
                  />
                )}
              </div>
            ))}
          </div>

          {/* Navigation Arrows */}
          {mediaItems.length > 1 && !isDragging && (
            <>
              <button
                type="button"
                onClick={() => goTo(index - 1)}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
              >
                <ChevronLeft className="w-7 h-7 text-white" />
              </button>
              <button
                type="button"
                onClick={() => goTo(index + 1)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
              >
                <ChevronRight className="w-7 h-7 text-white" />
              </button>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}