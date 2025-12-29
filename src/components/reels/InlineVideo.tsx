"use client";

import { useRef, useState } from "react";
import { Maximize2, Volume2, VolumeX } from "lucide-react";

export function InlineVideo({
  src,
  className = "w-full h-full object-cover",
  onExpand,
  showExpand = true,
  showMute = true,
  onError,
}: {
  src: string;
  className?: string;
  onExpand?: () => void;
  showExpand?: boolean;
  showMute?: boolean;
  onError?: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = async () => {
    const v = ref.current;
    if (!v) return;

    try {
      if (v.paused) {
        v.muted = muted;
        await v.play();
        setIsPlaying(true);
      } else {
        v.pause();
        setIsPlaying(false);
      }
    } catch {
      // ignore autoplay/play errors
    }
  };

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video
        ref={ref}
        src={src}
        className={className}
        playsInline
        preload="metadata"
        muted={muted}
        controls={false}
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => onError?.()}
      />

      {/* Tap anywhere toggles play/pause (no big icon) */}
      <button
        type="button"
        onClick={togglePlay}
        className="absolute inset-0"
        aria-label={isPlaying ? "Pause" : "Play"}
      />

      {/* Expand (top-right) */}
      {showExpand && onExpand && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          className="absolute top-2 right-2 z-10 p-2 rounded-full bg-black/45 hover:bg-black/70"
          style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
          aria-label="Expand"
        >
          <Maximize2 className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Mute (bottom-right) */}
      {showMute && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMuted((m) => {
              const next = !m;
              const v = ref.current;
              if (v) v.muted = next;
              return next;
            });
          }}
          className="absolute bottom-2 right-2 z-10 p-2 rounded-full bg-black/45 hover:bg-black/70"
          style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
        </button>
      )}
    </div>
  );
}