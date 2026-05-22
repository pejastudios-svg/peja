"use client";

// Full-screen circular avatar preview, opened when the user taps the
// avatar in the chat header. Matches the WhatsApp pattern — a large
// round zoom of the profile pic with the rest of the screen dimmed.
// Tap anywhere outside the circle (or the X) to close.

import { User, X } from "lucide-react";

interface Props {
  url?: string | null;
  name?: string | null;
  onClose: () => void;
}

export function AvatarPreview({ url, name, onClose }: Props) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] bg-black/95 flex flex-col items-center justify-center gap-6 p-6"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(80vw,360px)] aspect-square rounded-full overflow-hidden bg-[var(--chat-other-bg)] flex items-center justify-center shadow-2xl"
      >
        {url ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <User className="w-24 h-24 text-dark-400" />
        )}
      </div>

      {name && (
        <p className="text-white text-lg font-semibold tabular-nums">{name}</p>
      )}
    </div>
  );
}
