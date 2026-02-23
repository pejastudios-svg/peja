"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Play, Pause, Volume2, VolumeX } from "lucide-react";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { useAudio } from "@/context/AudioContext";
import { useVideoHandoff } from "@/context/VideoHandoffContext";
import { supabase } from "@/lib/supabase";
import { getVideoThumbnailUrl, getOptimizedVideoUrl, generateVideoThumbnail } from "@/lib/videoThumbnail";
import { useHlsPlayer } from "@/hooks/useHlsPlayer";

export function VideoLightbox({
  isOpen,
  onClose,
  videoUrl,
  startTime = 0,
  postId,
  posterUrl,
  sourceRect,
}: {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string | null;
  startTime?: number;
  postId?: string;
  posterUrl?: string | null;
  sourceRect?: { x: number; y: number; width: number; height: number } | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewedRef = useRef<Set<string>>(new Set());
  const handoff = useVideoHandoff();
  const hasAppliedHandoffRef = useRef(false);
  const closingRef = useRef(false);

  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showPoster, setShowPoster] = useState(true);
    const [generatedPoster, setGeneratedPoster] = useState<string | null>(null);
  const [videoBuffering, setVideoBuffering] = useState(true);
  const [animPhase, setAnimPhase] = useState<"idle" | "enter" | "open" | "exit">("idle");
  const exitTransformRef = useRef("scale(0.88)");
  const animSourceRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const hasStoredAnimRect = useRef(false);
    useHlsPlayer(videoRef, videoUrl || "", isOpen);

  const { soundEnabled, setSoundEnabled } = useAudio();

  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const fadeTimeout = useRef<NodeJS.Timeout | null>(null);

  const incrementView = async (id: string) => {
    if (viewedRef.current.has(id)) return;
    viewedRef.current.add(id);

    try {
      const { data: post } = await supabase
        .from("posts")
        .select("views")
        .eq("id", id)
        .single();

      if (post) {
        await supabase
          .from("posts")
          .update({ views: (post.views || 0) + 1 })
          .eq("id", id);
      }
    } catch (e) {
      console.error("Failed to increment view:", e);
    }
  };

  // Get effective start data from handoff
 const getEffectiveStartData = () => {
    const handoffData = handoff.getHandoff();
    if (handoffData && videoUrl && handoffData.src === videoUrl) {
      return {
        effectiveStartTime: handoffData.currentTime,
        effectivePoster: handoffData.posterDataUrl || posterUrl || (videoUrl ? getVideoThumbnailUrl(videoUrl) : null) || generatedPoster,
        effectiveSourceRect: handoffData.sourceRect || sourceRect || null,
      };
    }
    return {
      effectiveStartTime: startTime,
      effectivePoster: posterUrl || (videoUrl ? getVideoThumbnailUrl(videoUrl) : null) || generatedPoster,
      effectiveSourceRect: sourceRect || null,
    };
  };

  const { effectiveStartTime, effectivePoster, effectiveSourceRect } = isOpen
    ? getEffectiveStartData()
    : { effectiveStartTime: 0, effectivePoster: null, effectiveSourceRect: null };

  // Capture source rect once when opening (before handoff is cleared by effect)
  if (isOpen && !hasStoredAnimRect.current) {
    animSourceRectRef.current = effectiveSourceRect;
    hasStoredAnimRect.current = true;
  }
  if (!isOpen) {
    hasStoredAnimRect.current = false;
  }

  useEffect(() => {
    let expandTimer: NodeJS.Timeout | null = null;

    if (isOpen) {
      setShowPoster(true);
      setShowControls(true);
      setIsPlaying(true);
      setVideoBuffering(true);
      closingRef.current = false;
      hasAppliedHandoffRef.current = false;
      resetFadeTimer();
      document.body.style.overflow = "hidden";
      window.dispatchEvent(new Event("peja-modal-open"));

      if (postId) {
        incrementView(postId);
      }

      // Apply start time
      const v = videoRef.current;
      if (v && effectiveStartTime > 0) {
        const setTime = () => {
          v.currentTime = effectiveStartTime;
          v.removeEventListener("loadedmetadata", setTime);
        };
        if (v.readyState >= 1) {
          v.currentTime = effectiveStartTime;
        } else {
          v.addEventListener("loadedmetadata", setTime);
        }
      }

      // Clear handoff after using it
      handoff.clearHandoff();

      // Start expand animation
      setAnimPhase("enter");
      expandTimer = setTimeout(() => setAnimPhase("open"), 30);
    } else {
      document.body.style.overflow = "";
      setDragOffset({ x: 0, y: 0 });
      setShowPoster(true);
      setVideoBuffering(true);
      setGeneratedPoster(null);
      setAnimPhase("idle");
      animSourceRectRef.current = null;

      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    }
    return () => {
      document.body.style.overflow = "";
      if (expandTimer) clearTimeout(expandTimer);
    };
  }, [isOpen, effectiveStartTime, postId]);

  // Generate thumbnail for non-Cloudinary videos (Supabase-hosted)
  useEffect(() => {
    if (!videoUrl || !isOpen) return;
    if (posterUrl || getVideoThumbnailUrl(videoUrl)) return; // Already have a poster

    let cancelled = false;

    generateVideoThumbnail(videoUrl, 640).then((thumb) => {
      if (!cancelled && thumb) {
        setGeneratedPoster(thumb);
      }
    });

    return () => { cancelled = true; };
  }, [videoUrl, isOpen, posterUrl]);

  // Sync video muted state with global audio context
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.muted = !soundEnabled;
    }
  }, [soundEnabled]);

  const resetFadeTimer = () => {
    if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
    setShowControls(true);
    fadeTimeout.current = setTimeout(() => {
      if (isPlaying && !isDragging) setShowControls(false);
    }, 4000);
  };

  const handleClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;

    const v = videoRef.current;
    if (v && videoUrl) {
      handoff.returnTime(videoUrl, v.currentTime);
      v.pause();
    }

    // Compute exit transform — continue in drag direction if dragging
    if (dragDistance > 50) {
      exitTransformRef.current = `translate(${dragOffset.x * 2}px, ${dragOffset.y * 2}px) scale(0.5)`;
    } else {
      exitTransformRef.current = "scale(0.88)";
    }

    setAnimPhase("exit");

    setTimeout(() => {
      window.dispatchEvent(new Event("peja-modal-close"));
      onClose();
    }, 280);
  };

  const handleScreenTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showControls && isPlaying) {
      setShowControls(false);
      if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
    } else {
      resetFadeTimer();
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    setIsDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.touches[0].clientX - dragStartRef.current.x;
    const dy = e.touches[0].clientY - dragStartRef.current.y;
    setDragOffset({ x: dx, y: dy });
  };

  const onTouchEnd = () => {
    setIsDragging(false);
    dragStartRef.current = null;

    const distance = Math.sqrt(dragOffset.x ** 2 + dragOffset.y ** 2);

    if (distance > 100) {
      handleClose();
    } else {
      setDragOffset({ x: 0, y: 0 });
    }
  };

  const dragDistance = Math.sqrt(dragOffset.x ** 2 + dragOffset.y ** 2);
  const bgOpacity = Math.max(0, 1 - dragDistance / 400);

  const togglePlay = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsPlaying(true);
      resetFadeTimer();
    } else {
      v.pause();
      setIsPlaying(false);
      setShowControls(true);
      if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
    }
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const p = (v.currentTime / v.duration) * 100;
    setProgress(isNaN(p) ? 0 : p);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (v) {
      const time = (parseFloat(e.target.value) / 100) * v.duration;
      v.currentTime = time;
      setProgress(parseFloat(e.target.value));
    }
    resetFadeTimer();
  };

  // Hide poster once video has actual frames to show
  const handleVideoCanPlay = () => {
    setVideoBuffering(false);
    // Small delay to ensure frame is rendered
    setTimeout(() => {
      setShowPoster(false);
    }, 50);
  };

  // =====================================================
  // ANIMATION STYLE HELPERS
  // =====================================================
  const getBackdropStyle = (): React.CSSProperties => {
    if (animPhase === "exit") {
      return { opacity: 0, transition: "opacity 280ms ease" };
    }
    if (animPhase === "enter") {
      return { opacity: 0, transition: "none" };
    }
    return {
      opacity: bgOpacity,
      transition: isDragging ? "opacity 100ms ease-linear" : "opacity 300ms ease",
    };
  };

  const getVideoContainerStyle = (): React.CSSProperties => {
    if (animPhase === "exit") {
      return {
        transform: exitTransformRef.current,
        opacity: 0,
        borderRadius: "16px",
        overflow: "hidden",
        transition:
          "transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 250ms ease, border-radius 280ms ease",
      };
    }

    if (animPhase === "enter") {
      const rect = animSourceRectRef.current;
      let transform: string;
      if (rect && typeof window !== "undefined") {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const tx = rect.x + rect.width / 2 - vw / 2;
        const ty = rect.y + rect.height / 2 - vh / 2;
        const s = Math.min(rect.width / vw, rect.height / vh);
        transform = `translate(${tx}px, ${ty}px) scale(${Math.max(s, 0.08)})`;
      } else {
        transform = "scale(0.92)";
      }
      return {
        transform,
        opacity: 0.3,
        borderRadius: "16px",
        overflow: "hidden",
        transition: "none",
      };
    }

    // "open" phase — normal drag interaction
    if (isDragging || dragDistance > 0) {
      return {
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(${1 - dragDistance / 1000})`,
        transition: isDragging ? "none" : "transform 0.3s ease-out",
      };
    }

    return {
      transform: "none",
      opacity: 1,
      borderRadius: "0",
      transition:
        "transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 300ms ease, border-radius 300ms ease",
    };
  };

  if (!isOpen || !videoUrl) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center group touch-none"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
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
    >
      <div
        className="absolute inset-0 bg-black"
        style={getBackdropStyle()}
      />

      <div
        className={`absolute left-4 z-10 transition-opacity duration-300 ${
          showControls && animPhase !== "exit" ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ top: "calc(1rem + var(--cap-status-bar-height, 0px))" }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClose();
          }}
          className="p-2 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      </div>

      <div className="absolute inset-0 z-5" onClick={handleScreenTap} />

      <div
        className="relative z-1 w-full h-full flex items-center justify-center"
        style={getVideoContainerStyle()}
      >
        {/* Poster overlay - shows instantly, hides when video has frames */}
        {effectivePoster && showPoster && (
          <img
            src={effectivePoster}
            alt=""
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[2]"
          />
        )}

        {/* Loading spinner */}
        {videoBuffering && (
          <div className="absolute inset-0 flex items-center justify-center z-[3] pointer-events-none">
            <PejaSpinner className="w-14 h-14" />
          </div>
        )}

          <video
          ref={videoRef}
          src={videoUrl ? getOptimizedVideoUrl(videoUrl) : undefined}
          className="max-w-full max-h-full w-full h-full object-contain pointer-events-none"
          playsInline
          autoPlay
          preload="auto"
          loop
          muted={!soundEnabled}
          onTimeUpdate={handleTimeUpdate}
          onCanPlay={handleVideoCanPlay}
          onPlaying={handleVideoCanPlay}
          onWaiting={() => setVideoBuffering(true)}
          onEnded={() => setIsPlaying(false)}
          onLoadedData={() => {
            const v = videoRef.current;
            if (v && !hasAppliedHandoffRef.current && effectiveStartTime > 0) {
              if (Math.abs(v.currentTime - effectiveStartTime) > 0.5) {
                v.currentTime = effectiveStartTime;
              }
              hasAppliedHandoffRef.current = true;
            }
          }}
        />
      </div>

      <div
        className={`absolute bottom-0 inset-x-0 z-10 transition-all duration-300 ${
          showControls && !isDragging && animPhase !== "exit"
            ? "opacity-100 pointer-events-auto"
            : "pointer-events-none opacity-0"
        }`}
        style={{
          padding: "2.5rem 1.5rem",
          paddingBottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))",
          background:
            "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 max-w-2xl mx-auto w-full">
          <button onClick={togglePlay} className="text-white hover:text-primary-400 transition-colors">
            {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current" />}
          </button>

          <div className="flex-1 relative h-6 flex items-center group cursor-pointer">
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={isNaN(progress) ? 0 : progress}
              onChange={handleScrub}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="w-full h-1.5 bg-white/30 rounded-full relative">
              <div
                className="absolute left-0 top-0 h-full bg-primary-500 rounded-full"
                style={{ width: `${progress}%` }}
              />
              <div
                className="absolute top-1/2 -mt-2 h-4 w-4 bg-white rounded-full shadow-lg pointer-events-none transition-transform group-hover:scale-125"
                style={{ left: `calc(${progress}% - 8px)` }}
              />
            </div>
          </div>

          <button
            onPointerDownCapture={(e) => e.stopPropagation()}
            onTouchStartCapture={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setSoundEnabled(!soundEnabled);
            }}
            className="text-white hover:text-white/80"
          >
            {soundEnabled ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}