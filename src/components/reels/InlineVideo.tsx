"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Volume2, VolumeX, Play, Pause, Maximize2, ChevronLeft } from "lucide-react";
import { useAudio } from "@/context/AudioContext";
import { useVideoHandoff } from "@/context/VideoHandoffContext";
import { useAuth } from "@/context/AuthContext";
import { getVideoThumbnailUrl, getOptimizedVideoUrl, preloadVideoChunk, generateVideoThumbnail, getCachedVideoUrl, getCachedThumb, setCachedThumb } from "@/lib/videoThumbnail";
import { useHlsPlayer } from "@/hooks/useHlsPlayer";
import { useScrollFreeze } from "@/hooks/useScrollFreeze";
import { recordPostView } from "@/lib/postViews";

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
  postId,
}: {
  src: string;
  poster?: string;
  className?: string;
  onExpand?: (currentTime?: number, posterDataUrl?: string) => void;
  showExpand?: boolean;
  showMute?: boolean;
  onError?: () => void;
  autoPlay?: boolean;
  postId?: string;
}) {
  const instanceId = useId();
  const pathname = usePathname();
  const mountingPath = useRef(pathname);
  const currentPathRef = useRef(pathname);
  useEffect(() => {
    currentPathRef.current = pathname;
  }, [pathname]);
  const handoff = useVideoHandoff();
  const { user } = useAuth();

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Retries video load when Cloudinary returns an empty-body 200 during
  // async transcoding. First request triggers transcode; it's ready within
  // ~10-30s for short clips, so retry with backoff before giving up.
  const errorRetryRef = useRef(0);
  const errorRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (errorRetryTimerRef.current) clearTimeout(errorRetryTimerRef.current);
    };
  }, []);
  const scheduleVideoRetry = () => {
    const attempt = errorRetryRef.current;
    // Delays: 2s, 5s, 10s, 20s. Total ~37s before giving up — enough for
    // Cloudinary to finish async transcoding a short clip.
    const delays = [2000, 5000, 10000, 20000];
    if (attempt < delays.length) {
      errorRetryRef.current = attempt + 1;
      if (errorRetryTimerRef.current) clearTimeout(errorRetryTimerRef.current);
      errorRetryTimerRef.current = setTimeout(() => {
        const v = videoRef.current;
        if (!v) return;
        try { v.load(); } catch {}
      }, delays[attempt]);
    } else {
      onError?.();
    }
  };

  const blockedRef = useRef(false);
  const userPausedRef = useRef(false);
  const soundEnabledRef = useRef(false);
  // Prevents the video from blocking itself when it dispatches peja-modal-open
  const selfExpandingRef = useRef(false);

  const [showControls, setShowControls] = useState(true);
  const { soundEnabled, setSoundEnabled } = useAudio();
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // Self-expansion state (used when onExpand prop is not provided)
  const [expandPhase, setExpandPhase] = useState<"idle" | "enter" | "open" | "exit">("idle");
  const expandSourceRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDraggingExpanded, setIsDraggingExpanded] = useState(false);
  const expandDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const closingExpandRef = useRef(false);
  const isExpanded = expandPhase !== "idle";
  useScrollFreeze(isExpanded);

  const [generatedPoster, setGeneratedPoster] = useState<string | null>(() => getCachedThumb(src));
  const effectivePoster = poster || getVideoThumbnailUrl(src) || generatedPoster || undefined;
  useHlsPlayer(videoRef, src);
  const rawOptimized = getOptimizedVideoUrl(src);
  const optimizedSrc = getCachedVideoUrl(rawOptimized) || rawOptimized;

    // Generate thumbnail for non-Cloudinary videos (Supabase-hosted)
  useEffect(() => {
    if (poster || getVideoThumbnailUrl(src)) return; // Already have a poster
    if (!src) return;
    if (getCachedThumb(src)) return; // Already cached from a prior mount

    let cancelled = false;

    generateVideoThumbnail(src, 480).then((thumb) => {
      if (!cancelled && thumb) {
        setGeneratedPoster(thumb);
        setCachedThumb(src, thumb);
      }
    });

    return () => { cancelled = true; };
  }, [src, poster]);

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

  // ── Self-expansion (used when onExpand is not provided) ────────────────
  const getExpandedContainerStyle = (): React.CSSProperties => {
    const rect = expandSourceRectRef.current;
    const dist = Math.sqrt(dragOffset.x ** 2 + dragOffset.y ** 2);

    if (expandPhase === "enter" && rect) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const tx = rect.x + rect.width / 2 - vw / 2;
      const ty = rect.y + rect.height / 2 - vh / 2;
      const s = Math.min(rect.width / vw, rect.height / vh);
      return { position: "fixed", inset: 0, zIndex: 999998, backgroundColor: "black", display: "flex", alignItems: "center", justifyContent: "center", transform: `translate(${tx}px, ${ty}px) scale(${Math.max(s, 0.08)})`, transition: "none" };
    }
    if (expandPhase === "exit") {
      const exitT = dist > 50 ? `translate(${dragOffset.x * 2}px, ${dragOffset.y * 2}px) scale(0.5)` : "scale(0.88)";
      return { position: "fixed", inset: 0, zIndex: 999998, backgroundColor: "black", display: "flex", alignItems: "center", justifyContent: "center", transform: exitT, opacity: 0, transition: "transform 280ms cubic-bezier(0.2,0.8,0.2,1), opacity 250ms ease" };
    }
    if (isDraggingExpanded || dist > 0) {
      return { position: "fixed", inset: 0, zIndex: 999998, backgroundColor: "black", display: "flex", alignItems: "center", justifyContent: "center", transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(${1 - dist / 1000})`, transition: isDraggingExpanded ? "none" : "transform 0.3s ease-out" };
    }
    return { position: "fixed", inset: 0, zIndex: 999998, backgroundColor: "black", display: "flex", alignItems: "center", justifyContent: "center", transform: "none", transition: "transform 300ms cubic-bezier(0.2,0.8,0.2,1)" };
  };

  const handleSelfExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isExpanded || closingExpandRef.current) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) expandSourceRectRef.current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    selfExpandingRef.current = true;
    window.dispatchEvent(new Event("peja-modal-open"));
    selfExpandingRef.current = false;
    closingExpandRef.current = false;
    setSoundEnabled(true);
    if (postId) recordPostView(postId, user?.id);
    setExpandPhase("enter");
    requestAnimationFrame(() => requestAnimationFrame(() => setExpandPhase("open")));
  };

  const handleCollapse = () => {
    if (closingExpandRef.current) return;
    closingExpandRef.current = true;
    setExpandPhase("exit");
    setTimeout(() => {
      setExpandPhase("idle");
      expandSourceRectRef.current = null;
      setDragOffset({ x: 0, y: 0 });
      closingExpandRef.current = false;
      window.dispatchEvent(new Event("peja-modal-close"));
    }, 280);
  };

  const onExpandedTouchStart = (e: React.TouchEvent) => {
    expandDragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    setIsDraggingExpanded(true);
  };
  const onExpandedTouchMove = (e: React.TouchEvent) => {
    if (!expandDragStartRef.current) return;
    setDragOffset({ x: e.touches[0].clientX - expandDragStartRef.current.x, y: e.touches[0].clientY - expandDragStartRef.current.y });
  };
  const onExpandedTouchEnd = () => {
    setIsDraggingExpanded(false);
    expandDragStartRef.current = null;
    const dist = Math.sqrt(dragOffset.x ** 2 + dragOffset.y ** 2);
    if (dist > 100) handleCollapse();
    else setDragOffset({ x: 0, y: 0 });
  };

  const handleExpandedTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showControls && isPlaying) { setShowControls(false); if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); }
    else resetControlsTimer();
  };
  // ────────────────────────────────────────────────────────────────────────

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExpand) {
      const v = videoRef.current;
      const currentTime = v?.currentTime || 0;

      // Capture source rect for expand animation
      const elRect = wrapRef.current?.getBoundingClientRect();
      const sourceRect = elRect
        ? { x: elRect.x, y: elRect.y, width: elRect.width, height: elRect.height }
        : null;

      let posterDataUrl: string | undefined;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        try {
          const maxW = 720;
          const scale = Math.min(1, maxW / v.videoWidth);
          const cw = Math.round(v.videoWidth * scale);
          const ch = Math.round(v.videoHeight * scale);
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(v, 0, 0, cw, ch);
            posterDataUrl = canvas.toDataURL("image/jpeg", 0.7);
          }
        } catch {}
      }

handoff.beginExpand(src, currentTime, posterDataUrl || null, sourceRect);
      doPause();
      onExpand(currentTime, posterDataUrl);
    } else {
      handleSelfExpand(e);
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
        } else if (ratio >= 0.5) {
          preloadVideoChunk(optimizedSrc);
        }
        if (ratio >= 0.9) {
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
      if (selfExpandingRef.current) return; // Don't block ourselves when we're the one expanding
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

  // Reset video state when src changes (e.g. media carousel)
  useEffect(() => {
    setVideoReady(false);
    setIsPlaying(false);
    setProgress(0);
  }, [optimizedSrc]);

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

  const bgOpacity = isExpanded
    ? Math.max(0, 1 - Math.sqrt(dragOffset.x ** 2 + dragOffset.y ** 2) / 400)
    : 0;

  const videoEl = (
    <video
      ref={videoRef}
      src={optimizedSrc}
      poster={effectivePoster}
      className={isExpanded
        ? `max-w-full max-h-full object-contain pointer-events-none transition-opacity duration-100 ${!videoReady ? "opacity-0" : "opacity-100"}`
        : `${className} ${!videoReady ? "opacity-0" : "opacity-100"}`}
      playsInline
      preload="metadata"
      muted
      loop
      onTimeUpdate={handleTimeUpdate}
      onLoadStart={() => {
        if (errorRetryTimerRef.current) clearTimeout(errorRetryTimerRef.current);
        errorRetryTimerRef.current = setTimeout(() => {
          const v = videoRef.current;
          if (v && v.readyState < 1) scheduleVideoRetry();
        }, 6000);
      }}
      onLoadedMetadata={(e) => {
        if (errorRetryTimerRef.current) clearTimeout(errorRetryTimerRef.current);
        setDuration(e.currentTarget.duration);
      }}
      onLoadedData={() => { errorRetryRef.current = 0; }}
      onPlay={() => setIsPlaying(true)}
      onPlaying={() => setVideoReady(true)}
      onPause={() => { setIsPlaying(false); setShowControls(true); }}
      onError={scheduleVideoRetry}
      onStalled={scheduleVideoRetry}
    />
  );

  const posterEl = !videoReady && (
    <div className="absolute inset-0 z-[1] pointer-events-none">
      {effectivePoster
        ? <img
            src={effectivePoster}
            alt=""
            loading="eager"
            decoding="async"
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore — fetchpriority is valid HTML but not yet in React types
            fetchpriority="high"
            className={isExpanded ? "absolute inset-0 w-full h-full object-contain" : "w-full h-full object-cover"}
          />
        : <div className="w-full h-full bg-black" />}
    </div>
  );

  const controlsBar = (
    <div
      className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-300 z-[3] ${showControls || !isPlaying ? "opacity-100" : "opacity-0"}`}
      style={isExpanded ? { padding: "2.5rem 1.5rem", paddingBottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" } : { padding: "0.75rem" }}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3">
        <button onClick={togglePlay} className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors">
          {isPlaying ? <Pause className={isExpanded ? "w-6 h-6 fill-current" : "w-4 h-4 fill-current"} /> : <Play className={isExpanded ? "w-6 h-6 fill-current" : "w-4 h-4 fill-current"} />}
        </button>
        <div className="flex-1 relative h-6 flex items-center group/slider">
          <input type="range" min={0} max={100} step={0.1} value={progress} onChange={handleScrub}
            onMouseDown={() => setIsScrubbing(true)} onMouseUp={() => setIsScrubbing(false)}
            onTouchStart={(e) => { e.stopPropagation(); setIsScrubbing(true); }} onTouchEnd={() => setIsScrubbing(false)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
          <div className="w-full h-1.5 bg-white/30 rounded-full relative">
            <div className="absolute left-0 top-0 h-full bg-primary-500 rounded-full pointer-events-none" style={{ width: `${progress}%` }} />
            <div className="absolute top-1/2 -mt-1.5 h-3 w-3 bg-white rounded-full shadow-lg pointer-events-none transition-transform group-hover/slider:scale-125" style={{ left: `calc(${progress}% - 6px)` }} />
          </div>
        </div>
        {showMute && (
          <button onPointerDownCapture={(e) => e.stopPropagation()} onTouchStartCapture={(e) => e.stopPropagation()} onClick={handleMuteClick} className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors">
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        )}
        {showExpand && !isExpanded && (
          <button onClick={handleExpand} className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors">
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Backdrop for self-expanded mode */}
      {isExpanded && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 bg-black" style={{ zIndex: 999997, opacity: expandPhase === "enter" ? 0.6 : expandPhase === "exit" ? 0 : bgOpacity, transition: expandPhase === "exit" ? "opacity 280ms ease" : expandPhase === "enter" ? "none" : "opacity 100ms ease-linear" }} />,
        document.body
      )}

      <div
        ref={wrapRef}
        className="relative w-full h-full bg-black overflow-hidden group select-none"
        onClick={!isExpanded ? handleContainerClick : undefined}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Single video container — only CSS changes between inline/expanded, no React remount */}
        <div
          className={isExpanded ? "" : "absolute inset-0"}
          style={isExpanded ? getExpandedContainerStyle() : undefined}
          onClick={isExpanded ? handleExpandedTap : undefined}
          onTouchStart={isExpanded ? onExpandedTouchStart : undefined}
          onTouchMove={isExpanded ? onExpandedTouchMove : undefined}
          onTouchEnd={isExpanded ? onExpandedTouchEnd : undefined}
        >
          {videoEl}
          {posterEl}
          {/* Expanded: back button */}
          {isExpanded && expandPhase === "open" && (
            <div className="absolute z-10" style={{ top: "calc(1rem + var(--cap-status-bar-height, 0px))", left: "1rem" }}>
              <button onClick={(e) => { e.stopPropagation(); handleCollapse(); }} className="p-2 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60">
                <ChevronLeft className="w-8 h-8" />
              </button>
            </div>
          )}
          {/* Inline: play button overlays */}
          {!isExpanded && !isPlaying && !autoPlay && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-[2]">
              <button onClick={togglePlay} className="p-4 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors">
                <Play className="w-8 h-8 fill-current" />
              </button>
            </div>
          )}
          {!isExpanded && !videoReady && autoPlay && !isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center z-[2]">
              <button onClick={togglePlay} className="p-4 rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors">
                <Play className="w-8 h-8 fill-current" />
              </button>
            </div>
          )}
          {controlsBar}
        </div>
      </div>
    </>
  );
}