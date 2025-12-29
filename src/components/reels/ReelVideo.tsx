"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";

export function ReelVideo({
  src,
  active,
  onWatched2s,
  audioUnlocked = false,
}: {
  src: string;
  active: boolean;
  onWatched2s?: () => void;
  audioUnlocked?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const watchedTimerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);

  // auto play/pause when active changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    if (!active) {
      v.pause();
      setIsPlaying(false);
      if (watchedTimerRef.current) {
        window.clearTimeout(watchedTimerRef.current);
        watchedTimerRef.current = null;
      }
      return;
    }

    // iOS autoplay rules: must be muted to autoplay
    v.muted = muted;

    const play = async () => {
      try {
        await v.play();
        setIsPlaying(true);

        // count as view after 2s of active playback (once)
        if (!firedRef.current && onWatched2s) {
          watchedTimerRef.current = window.setTimeout(() => {
            firedRef.current = true;
            onWatched2s();
          }, 2000);
        }
      } catch {
        // If autoplay fails, user must tap to play
        setIsPlaying(false);
      }
    };
if (active) {
  // If user has "unlocked" audio, auto-unmute when this reel becomes active
  if (audioUnlocked) setMuted(false);
  else setMuted(true);
}
    play();

    return () => {
      if (watchedTimerRef.current) {
        window.clearTimeout(watchedTimerRef.current);
        watchedTimerRef.current = null;
      }
    };
  }, [active, muted, onWatched2s, audioUnlocked]);

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
      try {
        await v.play();
        setIsPlaying(true);
      } catch {}
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div className="relative w-full h-full bg-black select-none">
<video
  ref={videoRef}
  src={src}
  className="w-full h-full object-contain"
  playsInline
  preload="metadata"
  muted={muted}
  controls={false}
  controlsList="nodownload noplaybackrate noremoteplayback"
  disablePictureInPicture
  loop
  onPlay={() => setIsPlaying(true)}
  onPause={() => setIsPlaying(false)}
/>

      {/* Tap-to-toggle play */}
      <button
        type="button"
        onClick={togglePlay}
        className="absolute inset-0"
        aria-label="Toggle playback"
      />

    

      {/* Mute button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMuted((m) => !m);
          const v = videoRef.current;
          if (v) v.muted = !muted;
        }}
        className="absolute top-4 left-4 z-10 p-2 rounded-full bg-black/50"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      >
        {muted ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
        <div className="h-1 bg-white/80" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );
}