"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Loader2 } from "lucide-react";

const NUM_BARS = 32;

// Generate a pseudo-random fallback waveform
function generateFallbackWaveform(count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const seed = (i * 7 + 3) % 10;
    const base = 0.25 + seed * 0.065 + Math.sin(i * 0.8) * 0.15;
    return Math.min(Math.max(base, 0.15), 1.0);
  });
}

// Extract waveform peaks from audio data
async function extractWaveform(url: string, numBars: number): Promise<number[]> {
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioCtx();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const channelData = audioBuffer.getChannelData(0);
    const samplesPerBar = Math.floor(channelData.length / numBars);
    const peaks: number[] = [];

    for (let i = 0; i < numBars; i++) {
      const start = i * samplesPerBar;
      const end = Math.min(start + samplesPerBar, channelData.length);
      let peak = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > peak) peak = abs;
      }
      peaks.push(peak);
    }

    const maxPeak = Math.max(...peaks, 0.01);
    const normalized = peaks.map((p) => Math.max(0.1, p / maxPeak));

    audioContext.close().catch(() => {});
    return normalized;
  } catch (e) {
    console.log("[VoiceNotePlayer] Waveform extraction failed, using fallback:", e);
    return generateFallbackWaveform(numBars);
  }
}

interface VoiceNotePlayerProps {
  src: string;
  duration?: number; // Duration in seconds if known
  isMine?: boolean;
  fileName?: string;
}

export function VoiceNotePlayer({
  src,
  duration: initialDuration,
  isMine = false,
}: VoiceNotePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [error, setError] = useState(false);
  const [waveformData, setWaveformData] = useState<number[]>(
    generateFallbackWaveform(NUM_BARS)
  );
  const [isSeeking, setIsSeeking] = useState(false);

  // Format time as MM:SS
  const formatTime = useCallback((seconds: number): string => {
    if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Progress percentage (guarded against non-finite values)
  const safeDuration = isFinite(duration) && duration > 0 ? duration : 0;
  const progressPercent = safeDuration > 0 ? Math.min((currentTime / safeDuration) * 100, 100) : 0;

// Use fallback waveform instead of downloading the entire file.
  // extractWaveform fetches the full audio file just for visualization,
  // doubling egress for every voice note. The fallback looks good enough.
  useEffect(() => {
    if (!src) return;
    // Generate a deterministic pseudo-random waveform based on the URL
    // so the same voice note always looks the same
    let hash = 0;
    for (let i = 0; i < src.length; i++) {
      hash = ((hash << 5) - hash + src.charCodeAt(i)) | 0;
    }
    const seeded = Array.from({ length: NUM_BARS }, (_, i) => {
      const seed = Math.abs(((hash * (i + 1) * 9301 + 49297) % 233280) / 233280);
      return Math.max(0.15, Math.min(1.0, 0.2 + seed * 0.7 + Math.sin(i * 0.6) * 0.15));
    });
    setWaveformData(seeded);
  }, [src]);

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
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
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

    const handleDurationChange = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("playing", handlePlaying);
    audio.addEventListener("durationchange", handleDurationChange);

    audio.src = src;

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("durationchange", handleDurationChange);
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
    if (audio && isPlaying && !isSeeking) {
      setCurrentTime(audio.currentTime);

      // Fallback: pick up duration if it became available during playback
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration((prev) => {
          if (!prev || !isFinite(prev) || prev <= 0) return audio.duration;
          return prev;
        });
      }

      animationRef.current = requestAnimationFrame(updateProgress);
    }
  }, [isPlaying, isSeeking]);

  useEffect(() => {
    if (isPlaying && !isSeeking) {
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
  }, [isPlaying, isSeeking, updateProgress]);

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

  // Calculate seek position from pointer/touch event
  const getSeekPosition = useCallback(
    (clientX: number): number | null => {
      const bar = progressRef.current;
      if (!bar) return null;

      const effectiveDuration = audioRef.current?.duration || duration;
      if (!effectiveDuration || !isFinite(effectiveDuration) || effectiveDuration <= 0) return null;

      const rect = bar.getBoundingClientRect();
      if (rect.width === 0) return null;

      const x = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const newTime = percentage * effectiveDuration;

      if (!isFinite(newTime)) return null;
      return newTime;
    },
    [duration]
  );

  // Seek handlers
  const handleSeekStart = useCallback(
    (clientX: number) => {
      if (error || duration === 0) return;
      setIsSeeking(true);

      const newTime = getSeekPosition(clientX);
      if (newTime !== null) {
        const audio = audioRef.current;
        if (audio) audio.currentTime = newTime;
        setCurrentTime(newTime);
      }
    },
    [error, duration, getSeekPosition]
  );

  const handleSeekMove = useCallback(
    (clientX: number) => {
      if (!isSeeking) return;

      const newTime = getSeekPosition(clientX);
      if (newTime !== null) {
        const audio = audioRef.current;
        if (audio) audio.currentTime = newTime;
        setCurrentTime(newTime);
      }
    },
    [isSeeking, getSeekPosition]
  );

  const handleSeekEnd = useCallback(() => {
    setIsSeeking(false);
  }, []);

  // Mouse events for seeking
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    handleSeekStart(e.clientX);

    const onMouseMove = (ev: MouseEvent) => handleSeekMove(ev.clientX);
    const onMouseUp = () => {
      handleSeekEnd();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Touch events for seeking
  const handleWaveformTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    handleSeekStart(e.touches[0].clientX);
  };

  const handleWaveformTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    handleSeekMove(e.touches[0].clientX);
  };

  const handleWaveformTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    handleSeekEnd();
  };

  // Calculate which bar the scrubber indicator sits on
  const scrubberBarIndex =
    safeDuration > 0 && (isPlaying || currentTime > 0)
      ? Math.min(
          Math.floor((currentTime / safeDuration) * NUM_BARS),
          NUM_BARS - 1
        )
      : -1;

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

      {/* Waveform Scrubber */}
      <div className="flex-1 min-w-0">
        <div
          ref={progressRef}
          onMouseDown={handleMouseDown}
          onTouchStart={handleWaveformTouchStart}
          onTouchMove={handleWaveformTouchMove}
          onTouchEnd={handleWaveformTouchEnd}
          className="relative h-8 flex items-center gap-[2px] cursor-pointer group select-none touch-none"
        >
          {waveformData.map((amplitude, i) => {
            const barProgress = (i / waveformData.length) * 100;
            const isActive = barProgress <= progressPercent;
            const isAtScrubber = i === scrubberBarIndex;

            return (
              <div
                key={i}
                className="relative flex items-center justify-center"
                style={{ height: "100%", flex: "1 1 0" }}
              >
                <div
                  className={`w-[3px] rounded-full ${
                    isActive
                      ? isMine
                        ? "bg-white"
                        : "bg-primary-400"
                      : isMine
                      ? "bg-white/30"
                      : "bg-white/20"
                  }`}
                  style={{
                    height: `${Math.max(12, Math.min(80, amplitude * 80))}%`,
                    transform:
                      isPlaying && isActive ? "scaleY(1.08)" : "scaleY(1)",
                    transition:
                      "transform 0.1s ease, background-color 0.075s ease",
                  }}
                />
                {/* Scrubber indicator dot */}
                {isAtScrubber && (
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 w-[7px] h-[7px] rounded-full z-10 ${
                      isMine ? "bg-white" : "bg-primary-400"
                    }`}
                    style={{
                      boxShadow: isMine
                        ? "0 0 6px rgba(255,255,255,0.5)"
                        : "0 0 6px rgba(167,139,250,0.6)",
                    }}
                  />
                )}
              </div>
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