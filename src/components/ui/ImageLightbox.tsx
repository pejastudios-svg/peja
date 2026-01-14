"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Portal } from "@/components/ui/Portal";
import { InlineVideo } from "@/components/reels/InlineVideo";

export type MediaItem = { url: string; type: "image" | "video" };

export function ImageLightbox({
  isOpen,
  onClose,
  imageUrl,
  items,
  initialIndex = 0,

  // keep for backward compatibility (DO NOT render)
  caption,
}: {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  items?: MediaItem[];
  initialIndex?: number;

  // deprecated: not rendered anymore
  caption?: string | null;
}) {
  const mediaItems: MediaItem[] = useMemo(() => {
    if (items && items.length > 0) return items;
    if (imageUrl) return [{ url: imageUrl, type: "image" }];
    return [];
  }, [items, imageUrl]);

  const [index, setIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

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

  return (
    <Portal>
      <div className="fixed inset-0 z-[99999] bg-black" onClick={close}>
        {/* Top bar */}
        <div
          className="absolute top-0 left-0 right-0 z-[100000] flex items-center justify-between px-4"
          style={{ paddingTop: "calc(12px + env(safe-area-inset-top, 0px))", height: "56px" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-white/80 text-sm">
            {mediaItems.length > 1 ? `${index + 1} / ${mediaItems.length}` : ""}
          </div>

          <button
            type="button"
            onClick={close}
            className="p-2 rounded-full bg-black/60 hover:bg-black/80"
            aria-label="Close"
          >
            <X className="w-6 h-6 text-white" />
          </button>
        </div>

        {/* Carousel */}
        <div className="absolute inset-0" onClick={(e) => e.stopPropagation()}>
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
              <div key={i} className="w-full h-full shrink-0 snap-center flex items-center justify-center">
                {m.type === "video" ? (
                  <div className="w-full h-full">
                    <InlineVideo
                      src={m.url}
                      className="w-full h-full object-contain"
                      showExpand={false}
                      showMute={true}
                    />
                  </div>
                ) : (
                  <img src={m.url} alt="" className="w-full h-full object-contain" />
                )}
              </div>
            ))}
          </div>

          {mediaItems.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => goTo(index - 1)}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center"
              >
                <ChevronLeft className="w-7 h-7 text-white" />
              </button>
              <button
                type="button"
                onClick={() => goTo(index + 1)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center"
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