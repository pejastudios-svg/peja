"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Volume2, VolumeX, Play, Pause, Maximize2 } from "lucide-react";
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
  autoPlay = true,
}: {
  src: string;
  poster?: string;
  className?: string;
  onExpand?: (currentTime?: number, posterDataUrl?: string) => void;
  showExpand?: boolean;
  showMute?: boolean;
  onError?: () => void;
  autoPlay?: boolean;
}) {
  const instanceId = useId();
  const pathname = usePathname();
  const mountingPath = useRef(pathname);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const blockedRef = useRef(false);
  // Track whether the observer WANTS this video playing
  const shouldPlayRef = useRef(false);
  // Track whether user manually paused (so observer doesn't override)
  const userPausedRef = useRef(false);

  const [showControls, setShowControls] = useState(true);
  const { soundEnabled, setSoundEnabled } = useAudio();
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (pathname !== mountingPath.current) {
      setBlocked(true);
      blockedRef.current = true;
      const v = videoRef.current;
      if (v && !v.paused) {
        v.pause();
      }
    } else {
      setBlocked(false);
      blockedRef.current = false;
    }
  }, [pathname]);

  const resetControlsTimer = () => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    setShowControls(true);
    if (!videoRef.current?.paused) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isPlaying && !autoPlay) {
      userPausedRef.current = false;
      doPlay();
      return;
    }
    if (showControls) {
      setShowControls(false);
    } else {
      resetControlsTimer();
    }
  };

  // Core play — always starts muted first, then unmutes if allowed
  // This ensures mobile autoplay works (browsers require muted for autoplay)
  const doPlay = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      // Always attempt muted first for autoplay compatibility
      v.muted = true;
      await v.play();
      // If user has sound enabled and this was a user-initiated play or
      // sound was already enabled, unmute after successful play
      if (soundEnabled) {
        v.muted = false;
      }
      window.dispatchEvent(new CustomEvent(PLAYING_EVENT, { detail: { id: instanceId } }));
      resetControlsTimer();
    } catch {
      // Autoplay blocked even when muted — very rare, ignore
    }
  };

  const doPause = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
  };

  const togglePlay = async (e?: React.MouseEvent | React.TouchEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      userPausedRef.current = false;
      await doPlay();
    } else {
      userPausedRef.current = true;
      doPause();
    }
  };

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExpand) {
      const v = videoRef.current;
      const currentTime = v?.currentTime || 0;

      let posterDataUrl: string | undefined;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(v, 0, 0);
            posterDataUrl = canvas.toDataURL("image/jpeg", 0.7);
          }
        } catch {
          // CORS or other error, ignore
        }
      }

      doPause();
      onExpand(currentTime, posterDataUrl);
    }
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || isScrubbing) return;
    const p = (v.currentTime / v.duration) * 100;
    setProgress(isNaN(p) ? 0 : p);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    setProgress(val);
    v.currentTime = (val / 100) * v.duration;
    resetControlsTimer();
  };

  // Sync muted state with global audio context
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = !soundEnabled;
  }, [soundEnabled]);

  // Stop other videos when this one plays
  useEffect(() => {
    const handler = (e: any) => {
      if (e?.detail?.id === instanceId) return;
      const v = videoRef.current;
      if (v && !v.paused) {
        v.pause();
      }
    };
    window.addEventListener(PLAYING_EVENT, handler);
    return () => window.removeEventListener(PLAYING_EVENT, handler);
  }, [instanceId]);

  // SINGLE intersection observer — the only one
  // Pause at < 0.5 (half off screen), play at >= 0.9 (90% visible)
  useEffect(() => {
    if (!autoPlay) return;

    const el = wrapRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const ratio = entry.intersectionRatio;

        if (ratio < 0.5) {
          // Scrolled away — at least half off screen → pause
          shouldPlayRef.current = false;
          const v = videoRef.current;
          if (v && !v.paused) {
            v.pause();
          }
        } else if (ratio >= 0.9) {
          // 90% visible → auto play (unless user manually paused)
          shouldPlayRef.current = true;
          if (blockedRef.current) return;
          if (userPausedRef.current) return;
          const v = videoRef.current;
          if (v && v.paused) {
            // Use muted autoplay for reliability
            v.muted = true;
            v.play()
              .then(() => {
                if (soundEnabled) {
                  v.muted = false;
                }
                window.dispatchEvent(
                  new CustomEvent(PLAYING_EVENT, { detail: { id: instanceId } })
                );
              })
              .catch(() => {
                // Autoplay blocked, ignore
              });
          }
        }
        // Between 0.5 and 0.9: do nothing — keep current state
        // This prevents rapid toggling when scrolling slowly
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [autoPlay]);
  // NOTE: No other dependencies — we use refs for everything inside the callback
  // so the observer is created ONCE and never torn down/recreated

  // Modal open/close
  useEffect(() => {
    const onModalOpen = () => {
      setBlocked(true);
      blockedRef.current = true;
      const v = videoRef.current;
      if (v && !v.paused) v.pause();
    };
    const onModalClose = () => {
      setBlocked(false);
      blockedRef.current = false;
    };
    window.addEventListener("peja-modal-open", onModalOpen);
    window.addEventListener("peja-modal-close", onModalClose);
    return () => {
      window.removeEventListener("peja-modal-open", onModalOpen);
      window.removeEventListener("peja-modal-close", onModalClose);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full bg-black overflow-hidden group select-none"
      onPointerDownCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        setSoundEnabled(true);
      }}
      onTouchStartCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button")) return;
        setSoundEnabled(true);
      }}
      onClick={handleContainerClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className={className}
        playsInline
        preload="metadata"
        muted={!soundEnabled}
        loop
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          setShowControls(true);
        }}
        onError={() => onError?.()}
      />

      {/* Play button overlay when paused (for non-autoplay mode) */}
      {!isPlaying && !autoPlay && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-5">
          <button
            onClick={togglePlay}
            className="p-4 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors"
          >
            <Play className="w-8 h-8 fill-current" />
          </button>
        </div>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 p-3 bg-linear-to-t from-black/80 to-transparent transition-opacity duration-300 ${showControls || !isPlaying ? "opacity-100" : "opacity-0"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
          </button>

          <div className="flex-1 relative h-6 flex items-center group/slider">
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={progress}
              onChange={handleScrub}
              onMouseDown={() => setIsScrubbing(true)}
              onMouseUp={() => setIsScrubbing(false)}
              onTouchStart={(e) => {
                e.stopPropagation();
                setIsScrubbing(true);
              }}
              onTouchEnd={() => setIsScrubbing(false)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="w-full h-1.5 bg-white/30 rounded-full relative">
              <div
                className="absolute left-0 top-0 h-full bg-primary-500 rounded-full pointer-events-none"
                style={{ width: `${progress}%` }}
              />
              <div
                className="absolute top-1/2 -mt-1.5 h-3 w-3 bg-white rounded-full shadow-lg pointer-events-none transition-transform group-hover/slider:scale-125"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>
          </div>

          {showMute && (
            <button
              onPointerDownCapture={(e) => e.stopPropagation()}
              onTouchStartCapture={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setSoundEnabled(!soundEnabled);
              }}
              className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors"
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
            </button>
          )}

          {showExpand && onExpand && (
            <button
              onClick={handleExpand}
              className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}