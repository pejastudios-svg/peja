"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Volume2, VolumeX, Play, Pause, Maximize2 } from "lucide-react";
import { useAudio } from "@/context/AudioContext";
import { useVideoHandoff } from "@/context/VideoHandoffContext";
import { getVideoThumbnailUrl, getOptimizedVideoUrl, preloadVideoChunk } from "@/lib/videoThumbnail";
import { useHlsPlayer } from "@/hooks/useHlsPlayer";

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
  const currentPathRef = useRef(pathname);
  useEffect(() => {
    currentPathRef.current = pathname;
  }, [pathname]);
  const handoff = useVideoHandoff();

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const blockedRef = useRef(false);
  const userPausedRef = useRef(false);
  const soundEnabledRef = useRef(false);

  const [showControls, setShowControls] = useState(true);
  const { soundEnabled, setSoundEnabled } = useAudio();
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  const effectivePoster = poster || getVideoThumbnailUrl(src) || undefined;
    useHlsPlayer(videoRef, src);
  const optimizedSrc = getOptimizedVideoUrl(src);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    if (pathname !== mountingPath.current) {
      setBlocked(true);
      blockedRef.current = true;
      const v = videoRef.current;
      if (v && !v.paused) v.pause();
    } else {
      setBlocked(false);
      blockedRef.current = false;
    }
  }, [pathname]);

  useEffect(() => {
    const handleModalClose = () => {
      // Don't resume if this video isn't on the current page
      if (currentPathRef.current !== mountingPath.current) return;

      const returnTime = handoff.getReturnTime(src);
      if (returnTime !== null) {
        const v = videoRef.current;
        if (v) {
          v.currentTime = returnTime;
          handoff.clearReturnTime(src);
          userPausedRef.current = false;
          blockedRef.current = false;
          setBlocked(false);
          v.muted = true;
          v.play()
            .then(() => {
              if (soundEnabledRef.current) {
                v.muted = false;
              }
              window.dispatchEvent(
                new CustomEvent(PLAYING_EVENT, { detail: { id: instanceId } })
              );
            })
            .catch(() => {});
        }
      }
    };

    window.addEventListener("peja-modal-close", handleModalClose);
    return () => {
      window.removeEventListener("peja-modal-close", handleModalClose);
    };
  }, [src, instanceId, handoff]);

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

  const doPlay = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.muted = true;
      await v.play();
      if (soundEnabledRef.current) {
        v.muted = false;
      }
      window.dispatchEvent(
        new CustomEvent(PLAYING_EVENT, { detail: { id: instanceId } })
      );
      resetControlsTimer();
    } catch {}
  };

  const doPause = () => {
    const v = videoRef.current;
    if (!v || v.paused) return;
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
        } catch {}
      }

      handoff.beginExpand(src, currentTime, posterDataUrl || null);
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

  const handleMuteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newVal = !soundEnabled;
    setSoundEnabled(newVal);
    const v = videoRef.current;
    if (v) v.muted = !newVal;
  };

  useEffect(() => {
    const handler = (e: any) => {
      if (e?.detail?.id === instanceId) return;
      const v = videoRef.current;
      if (v && !v.paused) v.pause();
    };
    window.addEventListener(PLAYING_EVENT, handler);
    return () => window.removeEventListener(PLAYING_EVENT, handler);
  }, [instanceId]);

  useEffect(() => {
    if (!autoPlay) return;

    const el = wrapRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const ratio = entries[0].intersectionRatio;

        if (ratio < 0.5) {
          userPausedRef.current = false;
          const v = videoRef.current;
          if (v && !v.paused) v.pause();
          } else if (ratio >= 0.9) {
          preloadVideoChunk(optimizedSrc);
          if (blockedRef.current) return;
          if (userPausedRef.current) return;
          const v = videoRef.current;
          if (v && v.paused) {
            v.muted = true;
            v.play()
              .then(() => {
                if (soundEnabledRef.current) {
                  v.muted = false;
                }
                window.dispatchEvent(
                  new CustomEvent(PLAYING_EVENT, { detail: { id: instanceId } })
                );
              })
              .catch(() => {});
          }
        }
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [autoPlay, instanceId]);

  useEffect(() => {
    const onModalOpen = () => {
      setBlocked(true);
      blockedRef.current = true;
      const v = videoRef.current;
      if (v && !v.paused) v.pause();
    };
    window.addEventListener("peja-modal-open", onModalOpen);
    return () => {
      window.removeEventListener("peja-modal-open", onModalOpen);
    };
  }, []);

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
      onClick={handleContainerClick}
      onContextMenu={(e) => e.preventDefault()}
    >
        <video
        ref={videoRef}
        src={optimizedSrc}
        poster={effectivePoster}
        className={className}
        playsInline
        preload="auto"
        muted
        loop
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)}
        onPlaying={() => setVideoReady(true)}
        onPause={() => {
          setIsPlaying(false);
          setShowControls(true);
        }}
        onError={() => onError?.()}
      />

            {/* Poster overlay — prevents black flash until first frame renders */}
      {!videoReady && effectivePoster && (
        <img
          src={effectivePoster}
          alt=""
          className="absolute inset-0 w-full h-full object-cover z-[1] pointer-events-none"
        />
      )}

      {/* Loading shimmer when no poster available */}
      {!videoReady && !effectivePoster && (
        <div className="absolute inset-0 z-[1] pointer-events-none bg-dark-800 animate-pulse" />
      )}

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
        className={`absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-300 ${
          showControls || !isPlaying ? "opacity-100" : "opacity-0"
        }`}
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
              onClick={handleMuteClick}
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