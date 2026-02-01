"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Portal } from "@/components/ui/Portal";
import { InlineVideo } from "@/components/reels/InlineVideo";
import { supabase } from "@/lib/supabase";

export type MediaItem = { url: string; type: "image" | "video" };

export function ImageLightbox({
  isOpen,
  onClose,
  imageUrl,
  items,
  initialIndex = 0,
  onLongPress, 
  postId,
}: {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  items?: MediaItem[];
  initialIndex?: number;
  caption?: string | null;
  onLongPress?: () => void; 
   postId?: string;
}) {
  const mediaItems: MediaItem[] = useMemo(() => {
    if (items && items.length > 0) return items;
    if (imageUrl) return [{ url: imageUrl, type: "image" }];
    return [];
  }, [items, imageUrl]);

  const viewedRef = useRef<Set<string>>(new Set());

const incrementView = async (id: string) => {
  // Prevent duplicate views in this session
  if (viewedRef.current.has(id)) return;
  viewedRef.current.add(id);
  
  try {
    // Get current view count
    const { data: post } = await supabase
      .from("posts")
      .select("views")
      .eq("id", id)
      .single();
    
    if (post) {
      await supabase
        .from("posts")
        .update({ views: (post.views || 0) + 1 })
        .eq("id", id);
    }
  } catch (e) {
    console.error("Failed to increment view:", e);
  }
};

  const [index, setIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Drag State for vertical dismiss
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isHorizontalScrollRef = useRef(false);

  // Long press state
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
       if (postId) {
      incrementView(postId);
    }
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
    
    return () => { 
      document.body.style.overflow = ""; 
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, [isOpen, initialIndex, mediaItems.length, postId]);

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

  // --- Combined Touch Logic (vertical drag + horizontal scroll detection) ---
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      dragStartRef.current = { 
        x: e.touches[0].clientX, 
        y: e.touches[0].clientY 
      };
      setIsDragging(true);
      isHorizontalScrollRef.current = false;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragStartRef.current) return;
    
    const dx = e.touches[0].clientX - dragStartRef.current.x;
    const dy = e.touches[0].clientY - dragStartRef.current.y;
    
    // Determine if this is a horizontal scroll (for carousel) or vertical drag (for dismiss)
    if (!isHorizontalScrollRef.current && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      // Horizontal movement - let the carousel handle it
      isHorizontalScrollRef.current = true;
      setDragOffset(0);
      return;
    }
    
    // Vertical movement - handle dismiss gesture
    if (!isHorizontalScrollRef.current && Math.abs(dy) > 10) {
      setDragOffset(dy);
    }
  };

  const onTouchEnd = () => {
    dragStartRef.current = null;
    setIsDragging(false);

    // Only close if it was a vertical drag, not horizontal scroll
    if (!isHorizontalScrollRef.current && Math.abs(dragOffset) > 100) {
      onClose(); 
    } else {
      setDragOffset(0); 
    }
    
    isHorizontalScrollRef.current = false;
  };

  // --- Long Press Handlers ---
  const handlePointerDown = () => {
    if (!onLongPress) return;
    
    longPressTimerRef.current = setTimeout(() => {
      onLongPress();
      longPressTimerRef.current = null;
    }, 500);
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerLeave = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const bgOpacity = Math.max(0, 1 - Math.abs(dragOffset) / 400);
  const scale = Math.max(0.9, 1 - Math.abs(dragOffset) / 1000);

  return (
    <Portal>
      <div 
      className="fixed inset-0 z-[999999] flex flex-col touch-none"
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
          className={`relative z-10 flex items-center justify-between px-4 shrink-0 transition-opacity duration-200 ${isDragging && Math.abs(dragOffset) > 20 ? 'opacity-0' : 'opacity-100'}`}
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
          className="flex-1 relative"
          style={{ 
            transform: `translateY(${dragOffset}px) scale(${scale})`,
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
              touchAction: "pan-x", // ✅ Allow horizontal panning
            }}
            onScroll={handleScroll}
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
                  // ✅ Image with long press support
                  <div
                    className="w-full h-full flex items-center justify-center"
                    onPointerDown={handlePointerDown}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerLeave}
                    onPointerCancel={handlePointerUp}
                  >
                    <img 
                      src={m.url} 
                      alt="" 
                      className="w-full h-full object-contain max-h-screen pointer-events-none select-none" 
                      draggable={false}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Dots Indicator */}
        {mediaItems.length > 1 && (
          <div 
            className={`relative z-10 flex justify-center gap-2 py-4 transition-opacity duration-200 ${isDragging && Math.abs(dragOffset) > 20 ? 'opacity-0' : 'opacity-100'}`}
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