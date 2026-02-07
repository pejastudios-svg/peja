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
  const playRef = useRef<(() => Promise<void>) | null>(null);
  const pauseRef = useRef<(() => void) | null>(null);

  const [showControls, setShowControls] = useState(true); // Show controls by default
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
      pause();
    } else {
      setBlocked(false);
      blockedRef.current = false;
    }
  }, [pathname]);

  const resetControlsTimer = () => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    setShowControls(true);
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // If not playing, start playing on tap (for non-autoplay mode)
    if (!isPlaying && !autoPlay) {
      play();
      return;
    }
    if (showControls) {
      setShowControls(false);
    } else {
      resetControlsTimer();
    }
  };

  const pause = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
  };
  pauseRef.current = pause;

  const play = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (v.muted && soundEnabled) v.muted = false;
      await v.play();
      setIsPlaying(true);
      window.dispatchEvent(new CustomEvent(PLAYING_EVENT, { detail: { id: instanceId } }));
      resetControlsTimer();
    } catch {
      // autoplay block ignored
    }
  };
  playRef.current = play;

  const togglePlay = async (e?: React.MouseEvent | React.TouchEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) await play();
    else pause();
  };

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExpand) {
      const v = videoRef.current;
      const currentTime = v?.currentTime || 0;
      
      // Capture current frame as poster for instant lightbox display
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
          // CORS or other error, ignore — will fall back to thumbnail_url
        }
      }
      
      pause();
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

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = !soundEnabled;
  }, [soundEnabled]);

  // Stop other videos when this one plays
  useEffect(() => {
    const handler = (e: any) => {
      if (e?.detail?.id === instanceId) return;
      pause();
    };
    window.addEventListener(PLAYING_EVENT, handler);
    return () => window.removeEventListener(PLAYING_EVENT, handler);
  }, [instanceId]);

  // Intersection observer - only autoplay if autoPlay prop is true
  useEffect(() => {
    if (!autoPlay) return; // Skip if autoPlay is disabled
    
    const el = wrapRef.current;
    if (!el) return;
    
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.intersectionRatio < 0.25) {
          pauseRef.current?.();
        } else if (entry.intersectionRatio >= 0.6 && !blockedRef.current) {
          const v = videoRef.current;
          if (v && v.paused) playRef.current?.();
        }
      },
      { threshold: [0, 0.25, 0.6, 0.85] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [autoPlay]);

  useEffect(() => {
    const onModalOpen = () => { setBlocked(true); blockedRef.current = true; pause(); };
    const onModalClose = () => { setBlocked(false); blockedRef.current = false; };
    window.addEventListener("peja-modal-open", onModalOpen);
    window.addEventListener("peja-modal-close", onModalClose);
    return () => {
      window.removeEventListener("peja-modal-open", onModalOpen);
      window.removeEventListener("peja-modal-close", onModalClose);
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
      onPointerDownCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
        setSoundEnabled(true);
      }}
      onTouchStartCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;
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
        onPause={() => setIsPlaying(false)}
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
        className={`absolute inset-x-0 bottom-0 p-3 bg-linear-to-t from-black/80 to-transparent transition-opacity duration-300 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
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
              onTouchStart={(e) => { e.stopPropagation(); setIsScrubbing(true); }}
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
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
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