"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Maximize2, Volume2, VolumeX } from "lucide-react";
import { useAudio } from "@/context/AudioContext";

const PLAYING_EVENT = "peja-inline-video-playing";

export function InlineVideo({
  src,
  poster,
  className = "w-full h-full object-cover",
  onExpand,
  showExpand = true,
  showMute = true,
  onError,
}: {
  src: string;
  poster?: string;
  className?: string;
  onExpand?: () => void;
  showExpand?: boolean;
  showMute?: boolean;
  onError?: () => void;
}) {
  const instanceId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { soundEnabled, setSoundEnabled } = useAudio();
  const [isPlaying, setIsPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const pause = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
  };

  const play = async () => {
    const v = videoRef.current;
    if (!v) return;

    // Autoplay-safe: start muted first, then apply global sound
    try {
      v.muted = true;
      await v.play();
      setIsPlaying(true);

      // after it started, apply global preference
      v.muted = !soundEnabled;

      window.dispatchEvent(new CustomEvent(PLAYING_EVENT, { detail: { id: instanceId } }));
    } catch {
      // ignore
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
      if (e?.detail?.id === instanceId) return;
      pause();
    };
    window.addEventListener(PLAYING_EVENT, handler);
    return () => window.removeEventListener(PLAYING_EVENT, handler);
  }, [instanceId]);

  // Pause when leaving viewport, autoplay when mostly visible
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const ratio = entry?.intersectionRatio ?? 0;

        if (ratio < 0.25) {
          pause();
          return;
        }

        if (ratio >= 0.6) {
  // ✅ don't autoplay under overlays/modals
  if (blocked) {
    pause();
    return;
  }

  const v = videoRef.current;
  if (v && v.paused) play();
}
      },
      { threshold: [0, 0.25, 0.6, 0.85] }
    );

    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundEnabled]);

  // Pause on tab background
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Pause when ANY overlay/modal opens on top
 useEffect(() => {
  const onOverlayOpen = () => {
    setBlocked(true);
    pause();
  };
  const onOverlayClose = () => {
    setBlocked(false);
    // do not autoplay here — IntersectionObserver will do it if visible
  };

  const onModalOpen = () => {
    setBlocked(true);
    pause();
  };
  const onModalClose = () => {
    setBlocked(false);
  };

  window.addEventListener("peja-overlay-open", onOverlayOpen as any);
  window.addEventListener("peja-overlay-close", onOverlayClose as any);

  window.addEventListener("peja-modal-open", onModalOpen as any);
  window.addEventListener("peja-modal-close", onModalClose as any);

  return () => {
    window.removeEventListener("peja-overlay-open", onOverlayOpen as any);
    window.removeEventListener("peja-overlay-close", onOverlayClose as any);

    window.removeEventListener("peja-modal-open", onModalOpen as any);
    window.removeEventListener("peja-modal-close", onModalClose as any);
  };
}, []);

  return (
<div
  ref={wrapRef}
  className="relative w-full h-full bg-black overflow-hidden"
  onPointerDownCapture={() => {
    // ✅ ANY TAP anywhere on inline video enables global sound
    setSoundEnabled(true);
    const v = videoRef.current;
    if (v) v.muted = false;
  }}
>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className={className}
        playsInline
        preload="none"
        muted={!soundEnabled}
        controls={false}
        loop
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => onError?.()}
      />

      {/* Tap toggles play/pause */}
      <button type="button" onClick={togglePlay} className="absolute inset-0" aria-label="Toggle video" />

      {/* Expand */}
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

      {/* Global mute/unmute */}
      {showMute && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSoundEnabled(!soundEnabled);
            const v = videoRef.current;
            if (v) v.muted = soundEnabled;
          }}
          className="absolute bottom-2 right-2 z-10 p-2 rounded-full bg-black/45 hover:bg-black/70"
          style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}
          aria-label={soundEnabled ? "Mute" : "Unmute"}
        >
          {soundEnabled ? <Volume2 className="w-5 h-5 text-white" /> : <VolumeX className="w-5 h-5 text-white" />}
        </button>
      )}
    </div>
  );
}