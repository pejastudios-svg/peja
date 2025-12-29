"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Maximize2, Volume2, VolumeX } from "lucide-react";

const PLAYING_EVENT = "peja-inline-video-playing";

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
  const instanceId = useId(); // unique per component instance
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [muted, setMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  const pause = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
  };

  const play = async () => {
    const v = videoRef.current;
    if (!v) return;

    try {
      v.muted = muted;
      await v.play();
      setIsPlaying(true);

      // Tell other videos to pause
      window.dispatchEvent(new CustomEvent(PLAYING_EVENT, { detail: { id: instanceId } }));
    } catch {
      // ignore (iOS autoplay restrictions etc.)
    }
  };

  const togglePlay = async () => {
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) await play();
    else pause();
  };

  // Pause when another inline video starts playing
  useEffect(() => {
    const handler = (e: any) => {
      if (e?.detail?.id === instanceId) return; // ignore my own event
      pause();
    };
    window.addEventListener(PLAYING_EVENT, handler);
    return () => window.removeEventListener(PLAYING_EVENT, handler);
  }, [instanceId]);

  // Pause when leaving viewport
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // if less than 25% visible, pause
          if (entry.intersectionRatio < 0.25) {
            pause();
          }
        }
      },
      { threshold: [0, 0.25, 0.5] }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Pause on tab switch/background
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full h-full bg-black overflow-hidden">
      <video
        ref={videoRef}
        src={src}
        className={className}
        playsInline
        preload="metadata"
        muted={muted}
        controls={false}
        loop
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => onError?.()}
      />

      {/* Tap anywhere toggles play/pause */}
      <button type="button" onClick={togglePlay} className="absolute inset-0" aria-label="Toggle video" />

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
              const v = videoRef.current;
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