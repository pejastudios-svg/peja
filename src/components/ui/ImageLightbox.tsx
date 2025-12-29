"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Portal } from "@/components/ui/Portal";

type MediaItem = { url: string; type: "image" | "video" };

export function ImageLightbox({
  isOpen,
  onClose,
  imageUrl,
  caption,
  items,
  initialIndex = 0,
}: {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  caption?: string | null;

  // Optional: pass full carousel
  items?: MediaItem[];
  initialIndex?: number;
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
    setIndex(Math.min(Math.max(initialIndex, 0), Math.max(0, mediaItems.length - 1)));

    // snap to initial slide after open
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const w = el.clientWidth;
      el.scrollLeft = w * Math.min(Math.max(initialIndex, 0), Math.max(0, mediaItems.length - 1));
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
    const w = el.clientWidth;
    el.scrollTo({ left: w * clamped, behavior: "smooth" });
    setIndex(clamped);
  };

  return (
    <Portal>
      {/* IMPORTANT: valid z-index via Tailwind arbitrary value */}
      <div className="fixed inset-0 z-[9999]" onClick={close}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

        {/* Close button: always visible */}
        <button
          type="button"
          onClick={close}
          className="fixed top-4 right-4 z-[10000] p-2 rounded-full bg-black/60 hover:bg-black/80"
          style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
        >
          <X className="w-6 h-6 text-white" />
        </button>

        <div className="absolute inset-0 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="relative w-full max-w-xl glass-card p-3">
            {/* Carousel */}
            <div className="relative rounded-xl overflow-hidden bg-black">
              <div
                ref={scrollerRef}
                className="flex w-full overflow-x-auto snap-x snap-mandatory scroll-smooth"
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
                  <div key={i} className="w-full shrink-0 snap-center flex items-center justify-center">
                    {m.type === "video" ? (
                      <video
                        src={m.url}
                        className="w-full max-h-[70vh] object-contain"
                        controls
                        playsInline
                        preload="metadata"
                        controlsList="nodownload noplaybackrate noremoteplayback"
                        disablePictureInPicture
                      />
                    ) : (
                      <img src={m.url} alt="" className="w-full max-h-[70vh] object-contain" />
                    )}
                  </div>
                ))}
              </div>

              {mediaItems.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => goTo(index - 1)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center"
                  >
                    <ChevronLeft className="w-6 h-6 text-white" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goTo(index + 1)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center"
                  >
                    <ChevronRight className="w-6 h-6 text-white" />
                  </button>

                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {mediaItems.map((_, i) => (
                      <div
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full ${i === index ? "bg-white" : "bg-white/40"}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {caption ? (
              <div className="mt-3 text-sm text-dark-200 break-words whitespace-pre-wrap">
                {caption}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Portal>
  );
}