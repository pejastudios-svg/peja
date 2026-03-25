"use client";

import { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2 } from "lucide-react";

interface VoiceNotePlayerProps {
  src: string;
  compact?: boolean;
}

export function VoiceNotePlayer({ src, compact = false }: VoiceNotePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const updateProgress = () => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const p = (a.currentTime / a.duration) * 100;
    setProgress(isNaN(p) ? 0 : p);
    setCurrentTime(a.currentTime);
    if (playing) {
      animRef.current = requestAnimationFrame(updateProgress);
    }
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    } else {
      a.play().then(() => {
        setPlaying(true);
        animRef.current = requestAnimationFrame(updateProgress);
      }).catch(() => {});
    }
  };

  const handleScrub = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    a.currentTime = pct * a.duration;
    setProgress(pct * 100);
    setCurrentTime(a.currentTime);
  };

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Generate waveform bars (static visualization)
  const bars = 24;
  const waveform = useRef<number[]>(
    Array.from({ length: bars }, () => 0.2 + Math.random() * 0.8)
  ).current;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl ${compact ? "p-2" : "p-3"}`}
      style={{
        background: "rgba(124, 58, 237, 0.08)",
        border: "1px solid rgba(124, 58, 237, 0.15)",
      }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => {
          if (audioRef.current) {
            setDuration(audioRef.current.duration);
            setLoaded(true);
          }
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setCurrentTime(0);
          if (animRef.current) cancelAnimationFrame(animRef.current);
        }}
      />

      {/* Play/Pause button */}
      <button
        onClick={togglePlay}
        className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform"
        style={{
          width: compact ? 32 : 38,
          height: compact ? 32 : 38,
          background: playing
            ? "rgba(124, 58, 237, 0.3)"
            : "rgba(124, 58, 237, 0.2)",
          border: `1.5px solid ${playing ? "rgba(124, 58, 237, 0.5)" : "rgba(124, 58, 237, 0.3)"}`,
        }}
      >
        {playing ? (
          <Pause className="w-4 h-4 text-primary-400 fill-current" />
        ) : (
          <Play className="w-4 h-4 text-primary-400 fill-current ml-0.5" />
        )}
      </button>

      {/* Waveform + scrubber */}
      <div className="flex-1 min-w-0">
        <div
          className="relative h-8 flex items-center gap-[2px] cursor-pointer"
          onClick={handleScrub}
          onTouchStart={handleScrub}
        >
          {waveform.map((h, i) => {
            const barPct = ((i + 0.5) / bars) * 100;
            const isPlayed = barPct <= progress;
            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors duration-150"
                style={{
                  height: `${h * 100}%`,
                  minHeight: 3,
                  background: isPlayed
                    ? "rgba(124, 58, 237, 0.8)"
                    : "rgba(255, 255, 255, 0.12)",
                }}
              />
            );
          })}
        </div>

        {/* Time */}
        <div className="flex justify-between mt-0.5">
          <span className="text-[10px] text-dark-500">{formatTime(currentTime)}</span>
          <span className="text-[10px] text-dark-500">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Voice icon */}
      <Volume2 className={`w-3.5 h-3.5 shrink-0 ${playing ? "text-primary-400" : "text-dark-500"}`} />
    </div>
  );
}