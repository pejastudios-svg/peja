"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, Play, Pause } from "lucide-react";
import { useAudio } from "@/context/AudioContext";
import { useLongPress } from "@/components/hooks/useLongPress";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

export function ReelVideo({
  src,
  active,
  onWatched2s,
  onLongPress,
  onControlsChange,
}: {
  src: string;
  active: boolean;
  onWatched2s?: () => void;
  onLongPress?: () => void;
  onControlsChange?: (visible: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { soundEnabled, setSoundEnabled } = useAudio();

  const onWatched2sRef = useRef(onWatched2s);
  useEffect(() => {
    onWatched2sRef.current = onWatched2s;
  }, [onWatched2s]);

  const watchedTimerRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const [progress, setProgress] = useState(0);
  const [inView, setInView] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);

  // --- Long Press Logic ---
  const longPressGestures = useLongPress(() => {
    onLongPress?.();
  }, 500);

  // --- Sync Controls Visibility with Parent (for Back Button) ---
  useEffect(() => {
    onControlsChange?.(showControls);
  }, [showControls, onControlsChange]);

  // --- Visibility Logic ---
  const resetControlsTimer = () => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    setShowControls(true);
    if (isPlaying && !isScrubbing) {
      // 7 Seconds Fade Out
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 7000);
    }
  };

  const handleContainerClick = () => {
    // Tap toggles visibility, DOES NOT PAUSE
    if (showControls) {
      setShowControls(false);
    } else {
      resetControlsTimer();
    }
  };

  // --- Playback Logic ---
  const stopTimers = () => {
    if (watchedTimerRef.current) {
      window.clearTimeout(watchedTimerRef.current);
      watchedTimerRef.current = null;
    }
  };

  const pause = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
    setShowControls(true);
    stopTimers();
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
  };

  const ensurePlay = async () => {
    const v = videoRef.current;
    if (!v) return;

    try {
      v.muted = true;
      if (v.paused) await v.play();
      v.muted = !soundEnabled;
      
      setIsPlaying(true);
      resetControlsTimer();

      if (!firedRef.current && onWatched2sRef.current) {
        watchedTimerRef.current = window.setTimeout(() => {
          firedRef.current = true;
          onWatched2sRef.current?.();
        }, 2000);
      }
    } catch {
      setIsPlaying(false);
      setShowControls(true);
    }
  };

  const togglePlay = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      await ensurePlay();
    } else {
      pause();
    }
  };

  // --- Scrubber Logic ---
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || isScrubbing) return;
    if (!v.duration) return;
    const p = v.currentTime / v.duration;
    setProgress(p);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const val = parseFloat(e.target.value);
    setProgress(val);
    if (v.duration) v.currentTime = val * v.duration;
    resetControlsTimer();
  };

  // --- Effects ---
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        setInView(e.isIntersecting && e.intersectionRatio >= 0.6);
      },
      { threshold: [0, 0.2, 0.6, 0.9] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    // Logic to play/pause based on props
    if (!active || !inView) {
      pause();
      return;
    }
    ensurePlay();

    // --- CLEANUP (Runs when active changes OR component unmounts) ---
    return () => {
      stopTimers();
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.removeAttribute("src"); // Force stop downloading
        v.load(); 
      }
    };
  }, [active, inView]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = !soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    const onVis = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <div 
      ref={wrapRef} 
      className="relative w-full h-full bg-black select-none group"
      onClick={handleContainerClick}
      onContextMenu={(e) => e.preventDefault()} // <--- DISABLES BROWSER MENU
      onPointerDownCapture={() => setSoundEnabled(true)}
      onPointerDown={() => longPressGestures.onPointerDown()}
      onPointerUp={longPressGestures.onPointerUp}
      onPointerLeave={longPressGestures.onPointerLeave}
      onPointerCancel={longPressGestures.onPointerCancel}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain"
        playsInline
        preload="metadata"
        muted={!soundEnabled}
        loop
        disablePictureInPicture
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
      />

{isBuffering && (
  <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
    <PejaSpinner className="w-16 h-16 drop-shadow-2xl" />
  </div>
)}

      {/* --- Controls Overlay (Raised Higher) --- */}
      <div 
        className={`absolute bottom-0 inset-x-0 p-6 bg-linear-to-t from-black/90 via-black/50 to-transparent z-20 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()} // This prevents Long Press when using controls
        >
        <div 
          className="flex items-center gap-4 w-full mb-12" 
          style={{ paddingBottom: "env(safe-area-inset-bottom, 20px)" }}
        >
          {/* Play/Pause */}
          <button 
            onClick={togglePlay} 
            className="text-white hover:text-primary-400 transition-colors p-2"
          >
            {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current" />}
          </button>

          {/* Scrubber */}
          <div className="flex-1 relative h-6 flex items-center group cursor-pointer">
             <input 
               type="range" 
               min="0" 
               max="1" 
               step="0.001"
               value={progress}
               onChange={handleScrub}
               onMouseDown={() => setIsScrubbing(true)}
               onMouseUp={() => setIsScrubbing(false)}
               onTouchStart={() => setIsScrubbing(true)}
               onTouchEnd={() => setIsScrubbing(false)}
               className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
             />
             <div className="w-full h-1.5 bg-white/30 rounded-full relative">
                <div 
                  className="absolute left-0 top-0 h-full bg-primary-500 rounded-full pointer-events-none" 
                  style={{ width: `${progress * 100}%` }} 
                />
                <div 
                  className="absolute top-1/2 -mt-2 h-4 w-4 bg-white rounded-full shadow-lg pointer-events-none transition-transform group-hover:scale-125"
                  style={{ left: `calc(${progress * 100}% - 8px)` }}
                />
             </div>
          </div>

          {/* Mute */}
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setSoundEnabled(!soundEnabled);
            }} 
            className="text-white hover:text-white/80 p-2"
          >
            {soundEnabled ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>
  );
}