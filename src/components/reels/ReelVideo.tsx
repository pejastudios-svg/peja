"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useAudio } from "@/context/AudioContext";

export function ReelVideo({
  src,
  active,
  onWatched2s,
}: {
  src: string;
  active: boolean;
  onWatched2s?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { soundEnabled, setSoundEnabled } = useAudio();

  // stable callback
  const onWatched2sRef = useRef(onWatched2s);
  useEffect(() => {
    onWatched2sRef.current = onWatched2s;
  }, [onWatched2s]);

  const watchedTimerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const [progress, setProgress] = useState(0);
  const [inView, setInView] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ active: boolean; startX: number; startProgress: number }>({
    active: false,
    startX: 0,
    startProgress: 0,
  });

  const seekToProgress = (p: number) => {
    const v = videoRef.current;
    if (!v || !v.duration || Number.isNaN(v.duration)) return;
    const clamped = Math.min(Math.max(p, 0), 1);
    v.currentTime = clamped * v.duration;
    setProgress(clamped);
  };

  // in-view detection (pause when not visible)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        const ratio = e?.intersectionRatio ?? 0;
        setInView(ratio >= 0.6);
      },
      { threshold: [0, 0.2, 0.6, 0.9] }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onWaiting = () => setBuffering(true);
    const onStalled = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onCanPlay = () => setBuffering(false);

    v.addEventListener("waiting", onWaiting);
    v.addEventListener("stalled", onStalled);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("canplay", onCanPlay);

    return () => {
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("stalled", onStalled);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("canplay", onCanPlay);
    };
  }, []);

  const stopTimers = () => {
    if (watchedTimerRef.current) {
      window.clearTimeout(watchedTimerRef.current);
      watchedTimerRef.current = null;
    }
  };

  const pause = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    stopTimers();
  };

  const ensurePlay = async () => {
    const v = videoRef.current;
    if (!v) return;

    // autoplay-safe: always start muted, then apply global preference
    try {
      v.muted = true;
      if (v.paused) await v.play();

      // after playing, set to global preference (may remain muted if browser blocks)
      v.muted = !soundEnabled;

      if (!firedRef.current && onWatched2sRef.current) {
        watchedTimerRef.current = window.setTimeout(() => {
          firedRef.current = true;
          onWatched2sRef.current?.();
        }, 2000);
      }
    } catch {
      // user may need to tap
    }
  };

  // main lifecycle: only play if active AND visible
  useEffect(() => {
    if (!active || !inView) {
      pause();
      return;
    }

    ensurePlay();
    return () => stopTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, inView, soundEnabled]);

  // pause on background tab
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // progress bar
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      if (!v.duration || Number.isNaN(v.duration)) return;
      setProgress(v.currentTime / v.duration);
    };

    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, []);

  const togglePlay = async () => {
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      await ensurePlay();
    } else {
      pause();
    }
  };

  return (
    <div ref={wrapRef} className="relative w-full h-full bg-black select-none">
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain"
        playsInline
        preload="metadata"
        muted={!soundEnabled}
        controls={false}
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        loop
      />

      <button
        type="button"
        onClick={togglePlay}
        className="absolute inset-0"
        aria-label="Toggle playback"
      />

      {/* Global mute/unmute */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSoundEnabled(!soundEnabled);
          const v = videoRef.current;
          if (v) v.muted = soundEnabled;
        }}
        className="absolute top-4 left-4 z-10 p-2 rounded-full bg-black/50"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
        aria-label={soundEnabled ? "Mute" : "Unmute"}
      >
        {soundEnabled ? <Volume2 className="w-5 h-5 text-white" /> : <VolumeX className="w-5 h-5 text-white" />}
      </button>

     <div
  className="absolute bottom-0 left-0 right-0 px-4 pb-4"
  style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}
>
  {/* scrub track */}
  <div
    className={`relative h-2 rounded-full bg-white/20 overflow-hidden ${
      buffering ? "animate-pulse" : ""
    }`}
    onPointerDown={(e) => {
      e.stopPropagation();
      setIsDragging(true);
      dragRef.current.active = true;
      dragRef.current.startX = e.clientX;
      dragRef.current.startProgress = progress;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    }}
    onPointerMove={(e) => {
      if (!dragRef.current.active) return;
      const track = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - track.left;
      const p = x / Math.max(track.width, 1);
      seekToProgress(p);
    }}
    onPointerUp={(e) => {
      dragRef.current.active = false;
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {}
    }}
    onPointerCancel={(e) => {
      dragRef.current.active = false;
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {}
    }}
  >
    {/* filled */}
    <div
      className={`absolute left-0 top-0 h-full rounded-full ${
        buffering ? "bg-primary-400/90" : "bg-white/80"
      }`}
      style={{ width: `${Math.round(progress * 100)}%` }}
    />

    {/* knob */}
    <div
      className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full ${
        buffering ? "bg-primary-300" : "bg-white"
      } shadow-lg`}
      style={{ left: `calc(${Math.round(progress * 100)}% - 8px)` }}
    />
  </div>

  {/* tiny hint */}
  {isDragging && (
    <div className="mt-2 text-center text-xs text-white/70">
      Drag to seek
    </div>
  )}
</div>
    </div>
  );
}