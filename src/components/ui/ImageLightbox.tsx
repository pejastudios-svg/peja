"use client";

import { X } from "lucide-react";
import { Portal } from "@/components/ui/Portal";

export function ImageLightbox({
  isOpen,
  onClose,
  imageUrl,
  caption,
}: {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  caption?: string | null;
}) {
  if (!isOpen || !imageUrl) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[9999]">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="relative w-full max-w-xl glass-card p-3">
            <button
  onClick={onClose}
  className="fixed top-4 right-4 z-[10000] p-2 rounded-full bg-black/50 hover:bg-black/70"
  style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
>
  <X className="w-6 h-6 text-white" />
</button>

            <div className="rounded-xl overflow-hidden bg-black">
              <img src={imageUrl} alt="" className="w-full h-auto object-contain" />
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