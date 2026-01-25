"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation"; // <--- ADDED
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
}: {
  src: string;
  poster?: string;
  className?: string;
  onExpand?: () => void;
  showExpand?: boolean;
  showMute?: boolean;
  onError?: () => void;
}) {
  const instanceId = useId();
  const pathname = usePathname(); // <--- ADDED
  const mountingPath = useRef(pathname); // <--- TRACK ORIGINAL PAGE

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // State
  const [showControls, setShowControls] = useState(false);
  const { soundEnabled, setSoundEnabled } = useAudio();
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [blocked, setBlocked] = useState(false);

  // --- ROUTE CHANGE LOGIC (FIX FOR BACKGROUND AUDIO) ---
  useEffect(() => {
    // If the current URL is different from where this video was mounted,
    // it means we are on a different "page" (overlay/modal), so BLOCK playback.
    if (pathname !== mountingPath.current) {
      setBlocked(true);
      pause();
    } else {
      // If we returned to the original page, unblock (IntersectionObserver will resume if visible)
      setBlocked(false);
    }
  }, [pathname]);

  // --- Visibility Logic ---
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
    if (showControls) {
      setShowControls(false);
    } else {
      resetControlsTimer();
    }
  };

  // --- Playback Logic ---
  const pause = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
  };

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
      pause(); 
      onExpand();
    }
  };

  // --- Scrubber Logic ---
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

  // --- Effects ---
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = !soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    const handler = (e: any) => {
      if (e?.detail?.id === instanceId) return;
      pause();
    };
    window.addEventListener(PLAYING_EVENT, handler);
    return () => window.removeEventListener(PLAYING_EVENT, handler);
  }, [instanceId]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.intersectionRatio < 0.25) pause();
        if (entry.intersectionRatio >= 0.6 && !blocked) {
           const v = videoRef.current;
           if (v && v.paused) play();
        }
      },
      { threshold: [0, 0.25, 0.6, 0.85] }
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked]); // Depend on blocked so observer updates when route changes

  useEffect(() => {
    const onModalOpen = () => { setBlocked(true); pause(); };
    const onModalClose = () => { setBlocked(false); };
    window.addEventListener("peja-modal-open", onModalOpen);
    window.addEventListener("peja-modal-close", onModalClose);
    return () => {
        window.removeEventListener("peja-modal-open", onModalOpen);
        window.removeEventListener("peja-modal-close", onModalClose);
    };
  }, []);

// --- Strict Unmount Cleanup ---
  useEffect(() => {
    return () => {
      // Force pause when component unmounts
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.removeAttribute("src"); // Optional: Release memory
        v.load();
      }
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full bg-black overflow-hidden group select-none"
      onPointerDownCapture={() => setSoundEnabled(true)}
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

      <div 
        className={`absolute inset-x-0 bottom-0 p-3 bg-linear-to-t from-black/80 to-transparent transition-opacity duration-300 opacity-0 group-hover:opacity-100 ${showControls ? 'opacity-100!' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
          </button>

          {/* Scrubber */}
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

          {/* Mute */}
          {showMute && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSoundEnabled(!soundEnabled);
              }}
              className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition-colors"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          )}

          {/* Expand */}
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