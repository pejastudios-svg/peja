"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Loader2 } from "lucide-react";

interface VoiceNotePlayerProps {
  src: string;
  duration?: number; // Duration in seconds if known
  isMine?: boolean;
  fileName?: string;
}

export function VoiceNotePlayer({ src, duration: initialDuration, isMine = false }: VoiceNotePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [error, setError] = useState(false);

  // Format time as MM:SS
  const formatTime = useCallback((seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Progress percentage
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Initialize audio element
  useEffect(() => {
    if (!src) {
      setError(true);
      setIsLoading(false);
      return;
    }

    const audio = new Audio();
    audioRef.current = audio;

    audio.preload = "metadata";

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoading(false);
      setError(false);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };

    const handleError = () => {
      console.error("[VoiceNotePlayer] Error loading audio:", src);
      setError(true);
      setIsLoading(false);
      setIsPlaying(false);
    };

    const handleWaiting = () => {
      setIsLoading(true);
    };

    const handlePlaying = () => {
      setIsLoading(false);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("playing", handlePlaying);

    audio.src = src;

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("playing", handlePlaying);
      audio.pause();
      audio.src = "";
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [src]);

  // Animation frame for smooth progress updates
  const updateProgress = useCallback(() => {
    const audio = audioRef.current;
    if (audio && isPlaying) {
      setCurrentTime(audio.currentTime);
      animationRef.current = requestAnimationFrame(updateProgress);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateProgress);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, updateProgress]);

  // Toggle play/pause
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || error) return;

    try {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        setIsLoading(true);
        await audio.play();
        setIsPlaying(true);
        setIsLoading(false);
      }
    } catch (e) {
      console.error("[VoiceNotePlayer] Play error:", e);
      setError(true);
      setIsLoading(false);
    }
  };

  // Seek on progress bar click
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const progressBar = progressRef.current;
    if (!audio || !progressBar || error || duration === 0) return;

    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;

    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // Generate waveform bars (static visualization)
  const waveformBars = Array.from({ length: 28 }, (_, i) => {
    // Create a pseudo-random pattern that looks like audio waveform
    const seed = (i * 7 + 3) % 10;
    const height = 20 + seed * 6 + Math.sin(i * 0.8) * 15;
    return Math.min(Math.max(height, 12), 80);
  });

  if (error) {
    return (
      <div
        className={`flex items-center gap-3 p-3 rounded-2xl min-w-[200px] ${
          isMine ? "bg-white/10" : "bg-white/5"
        }`}
      >
        <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
          <span className="text-red-400 text-xs">!</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-red-400">Failed to load audio</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-2xl min-w-[220px] max-w-[280px] ${
        isMine ? "bg-white/10" : "bg-white/5"
      }`}
    >
      {/* Play/Pause Button */}
      <button
        onClick={togglePlay}
        disabled={isLoading && !isPlaying}
        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 ${
          isMine
            ? "bg-white/20 hover:bg-white/30"
            : "bg-primary-600/30 hover:bg-primary-600/40"
        }`}
      >
        {isLoading && !isPlaying ? (
          <Loader2 className="w-5 h-5 text-white/70 animate-spin" />
        ) : isPlaying ? (
          <Pause className="w-5 h-5 text-white fill-white" />
        ) : (
          <Play className="w-5 h-5 text-white fill-white ml-0.5" />
        )}
      </button>

      {/* Waveform & Progress */}
      <div className="flex-1 min-w-0">
        <div
          ref={progressRef}
          onClick={handleProgressClick}
          className="relative h-8 flex items-center gap-[2px] cursor-pointer group"
        >
          {waveformBars.map((height, i) => {
            const barProgress = (i / waveformBars.length) * 100;
            const isActive = barProgress <= progressPercent;

            return (
              <div
                key={i}
                className={`w-[3px] rounded-full transition-all duration-75 ${
                  isActive
                    ? isMine
                      ? "bg-white"
                      : "bg-primary-400"
                    : isMine
                    ? "bg-white/30"
                    : "bg-white/20"
                }`}
                style={{
                  height: `${height}%`,
                  transform: isPlaying && isActive ? "scaleY(1.1)" : "scaleY(1)",
                }}
              />
            );
          })}
        </div>

        {/* Time Display */}
        <div className="flex items-center justify-between mt-1">
          <span
            className={`text-[10px] font-mono ${
              isMine ? "text-white/60" : "text-dark-400"
            }`}
          >
            {formatTime(currentTime)}
          </span>
          <span
            className={`text-[10px] font-mono ${
              isMine ? "text-white/40" : "text-dark-500"
            }`}
          >
            {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}