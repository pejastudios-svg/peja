"use client";

// Reusable inline video player with custom controls.
//
// Lifted out of VideoLightbox so it can be reused by MediaCarousel
// for the video slides of a multi-media bundle. The component is
// itself NOT fullscreen — the parent wraps it in whatever modal
// shell (dark backdrop, close X, carousel nav) is appropriate.
//
// Why custom controls (and not <video controls>):
//   • Native controls on Capacitor WebView render inconsistently
//     (the bug we hit before).
//   • Native controls on mobile don't expose playback speed at all.
//   • Tap-anywhere-on-video toggles play/pause as a generous tap
//     target (much bigger than the native control bar).
//
// Control set: play/pause, elapsed, draggable scrubber, total
// duration, 1×/1.5×/2× speed cycle, mute toggle.

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";

interface Props {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  // Outer container — typically full viewport from the parent modal.
  // Defaults to "max-w-full max-h-full".
  className?: string;
}

const SPEEDS: Array<{ label: string; value: number }> = [
  { label: "1×", value: 1 },
  { label: "1.5×", value: 1.5 },
  { label: "2×", value: 2 },
];

export function VideoPlayer({ src, poster, autoPlay, className }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
      }
    };
    const onTime = () => setCurrentTime(el.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onVolume = () => setMuted(el.muted);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("volumechange", onVolume);
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("volumechange", onVolume);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = SPEEDS[speedIdx].value;
    }
  }, [speedIdx]);

  // RAF poll — Capacitor WebView occasionally drops `timeupdate` events.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = videoRef.current;
      if (el) {
        const playing = !el.paused && !el.ended;
        setIsPlaying((prev) => (prev !== playing ? playing : prev));
        if (playing) setCurrentTime(el.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const togglePlay = useCallback(async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (el.paused) await el.play();
      else el.pause();
    } catch (e) {
      console.warn("[video-player] play failed", e);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => (i + 1) % SPEEDS.length);
  }, []);

  const fractionFromX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const commitSeek = useCallback(
    (fraction: number) => {
      const el = videoRef.current;
      if (!el || !duration) return;
      el.currentTime = fraction * duration;
    },
    [duration]
  );

  const onSeekPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const target = e.currentTarget as HTMLDivElement;
      target.setPointerCapture?.(e.pointerId);
      setDragFraction(fractionFromX(e.clientX));
    },
    [fractionFromX]
  );

  const onSeekPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragFraction === null) return;
      setDragFraction(fractionFromX(e.clientX));
    },
    [dragFraction, fractionFromX]
  );

  const onSeekPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget as HTMLDivElement;
      target.releasePointerCapture?.(e.pointerId);
      if (dragFraction === null) return;
      commitSeek(dragFraction);
      setDragFraction(null);
    },
    [dragFraction, commitSeek]
  );

  const liveFraction = duration > 0 ? currentTime / duration : 0;
  const progressFraction = dragFraction ?? liveFraction;
  const displayedCurrent =
    dragFraction !== null ? dragFraction * duration : currentTime;

  return (
    <div
      className={`relative max-w-full max-h-full flex items-center justify-center ${className ?? ""}`}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        playsInline
        onClick={togglePlay}
        className="max-w-full max-h-[100vh] block cursor-pointer"
      />

      <div className="absolute left-0 right-0 -bottom-px px-3 pt-10 pb-4 bg-gradient-to-t from-black via-black/55 to-transparent pointer-events-none">
        <div className="flex items-center gap-3 text-white pointer-events-auto">
          <button
            type="button"
            onClick={togglePlay}
            className="shrink-0 w-9 h-9 flex items-center justify-center"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" fill="currentColor" />
            ) : (
              <Play
                className="w-5 h-5"
                fill="currentColor"
                style={{ marginLeft: "1px" }}
              />
            )}
          </button>

          <span className="text-[11px] tabular-nums shrink-0 min-w-[36px]">
            {formatTime(displayedCurrent)}
          </span>

          <div
            ref={trackRef}
            onPointerDown={onSeekPointerDown}
            onPointerMove={onSeekPointerMove}
            onPointerUp={onSeekPointerUp}
            onPointerCancel={onSeekPointerUp}
            className="relative flex-1 h-1.5 bg-white/25 rounded-full cursor-pointer select-none touch-none"
          >
            <div
              className="absolute left-0 top-0 bottom-0 bg-white rounded-full"
              style={{ width: `${(progressFraction * 100).toFixed(2)}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow"
              style={{ left: `${(progressFraction * 100).toFixed(2)}%` }}
            />
          </div>

          <span className="text-[11px] tabular-nums shrink-0 min-w-[36px]">
            {formatTime(duration)}
          </span>

          <button
            type="button"
            onClick={cycleSpeed}
            className="shrink-0 text-[11px] font-semibold min-w-[28px] text-center"
            aria-label="Playback speed"
          >
            {SPEEDS[speedIdx].label}
          </button>

          <button
            type="button"
            onClick={toggleMute}
            className="shrink-0 w-9 h-9 flex items-center justify-center"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <VolumeX className="w-5 h-5" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
