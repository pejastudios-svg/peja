"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
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
  const isScrollingRef = useRef(false);

  // Drag State for vertical dismiss
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      setDragOffset(0);
      document.body.style.overflow = "";
    }

    if (isOpen) {
      const nextIndex = Math.min(Math.max(initialIndex, 0), Math.max(0, mediaItems.length - 1));
      setIndex(nextIndex);

      requestAnimationFrame(() => {
        const el = scrollerRef.current;
        if (!el) return;
        const w = el.clientWidth || 1;
        el.scrollLeft = w * nextIndex;
      });
    }
    
    return () => { document.body.style.overflow = ""; };
  }, [isOpen, initialIndex, mediaItems.length]);

  if (!isOpen || mediaItems.length === 0) return null;

  const close = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onClose();
  };

  // --- Horizontal scroll handler ---
  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    const newIndex = Math.round(el.scrollLeft / w);
    if (newIndex !== index) setIndex(newIndex);
  };

  // --- Vertical Drag Logic (only when not horizontally scrolling) ---
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      dragStartY.current = e.touches[0].clientY;
      setIsDragging(true);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    
    // Only allow vertical drag if we're not in the middle of horizontal scroll
    if (isScrollingRef.current) return;
    
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
        className="fixed inset-0 z-[99999] flex flex-col"
        onClick={close}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Dynamic Background */}
        <div 
          className="absolute inset-0 bg-black transition-opacity duration-100 ease-linear"
          style={{ opacity: bgOpacity }}
        />

        {/* Top bar */}
        <div
          className={`relative z-10 flex items-center justify-between px-4 shrink-0 transition-opacity duration-200 ${isDragging ? 'opacity-0' : 'opacity-100'}`}
          style={{ paddingTop: "calc(12px + env(safe-area-inset-top, 0px))", height: "56px" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={close}
            className="p-2 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md"
            aria-label="Close"
          >
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>

          {/* Empty spacer for centering */}
          <div className="w-10" />
        </div>

        {/* Main Content Area - Draggable */}
        <div 
          className="flex-1 relative transition-transform duration-200 ease-out"
          style={{ 
            transform: `translateY(${dragOffset}px)`,
            transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
          }}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Horizontal Carousel */}
          <div
            ref={scrollerRef}
            className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide"
            style={{ 
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
            onScroll={handleScroll}
            onTouchStart={() => { isScrollingRef.current = true; }}
            onTouchEnd={() => { setTimeout(() => { isScrollingRef.current = false; }, 100); }}
          >
            {mediaItems.map((m, i) => (
              <div 
                key={i} 
                className="w-full h-full shrink-0 snap-center snap-always flex items-center justify-center p-2"
                style={{ scrollSnapStop: "always" }}
              >
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
                    draggable={false}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Dots Indicator */}
        {mediaItems.length > 1 && (
          <div 
            className={`relative z-10 flex justify-center gap-2 py-4 transition-opacity duration-200 ${isDragging ? 'opacity-0' : 'opacity-100'}`}
            style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}
            onClick={(e) => e.stopPropagation()}
          >
            {mediaItems.map((_, i) => (
              <div 
                key={i} 
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === index 
                    ? "bg-white w-6" 
                    : "bg-white/40 w-2"
                }`} 
              />
            ))}
          </div>
        )}
      </div>
    </Portal>
  );
}