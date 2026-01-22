"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Play, Pause, Volume2, VolumeX } from "lucide-react";

export function VideoLightbox({
  isOpen,
  onClose,
  videoUrl,
}: {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  
  // Swipe State
  const [touchStart, setTouchStart] = useState<number | null>(null);
  
  const fadeTimeout = useRef<NodeJS.Timeout | null>(null);

  // --- Init & Cleanup ---
  useEffect(() => {
    if (isOpen) {
      setShowControls(true);
      setIsPlaying(true);
      resetFadeTimer();
      document.body.style.overflow = "hidden";
      
      // Pause background videos
      window.dispatchEvent(new Event("peja-modal-open"));
    } else {
      document.body.style.overflow = "";
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
      // Resume background interaction (optional, but good practice)
      window.dispatchEvent(new Event("peja-modal-close"));
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  // --- Fade Logic ---
  const resetFadeTimer = () => {
    if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
    setShowControls(true);
    fadeTimeout.current = setTimeout(() => {
      // Fade out only if playing
      if (isPlaying) setShowControls(false);
    }, 7000);
  };

  const handleScreenTap = () => {
    if (showControls) {
      // If controls are visible and video is playing, hide them immediately
      if (isPlaying) {
        setShowControls(false);
        if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
      }
    } else {
      // Show controls and restart timer
      resetFadeTimer();
    }
  };

  // --- Playback Logic ---
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
      setShowControls(true); // Keep controls visible when paused
      if (fadeTimeout.current) clearTimeout(fadeTimeout.current);
    }
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (v) setProgress((v.currentTime / v.duration) * 100);
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

  // --- Swipe Logic ---
  const onTouchStart = (e: React.TouchEvent) => setTouchStart(e.touches[0].clientX);
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart) return;
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;

    // > 75px horizontal swipe triggers close
    if (Math.abs(diff) > 75) {
      onClose();
    }
    setTouchStart(null);
  };

  if (!isOpen || !videoUrl) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Back Button (Top Left) */}
      <div 
        className={`absolute top-4 left-4 z-50 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <button 
          onClick={onClose}
          className="p-2 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      </div>

      {/* Screen Tap Layer */}
      <div className="absolute inset-0 z-10" onClick={handleScreenTap} />

      {/* Video */}
      <video
        ref={videoRef}
        src={videoUrl}
        className="max-w-full max-h-full w-full h-full object-contain"
        playsInline
        autoPlay
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Bottom Controls */}
      <div 
        className={`absolute bottom-0 inset-x-0 p-6 bg-linear-to-t from-black/90 via-black/50 to-transparent z-20 transition-opacity duration-500 ${showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      >
        <div className="flex items-center gap-4 max-w-2xl mx-auto w-full">
          {/* Play/Pause */}
          <button onClick={togglePlay} className="text-white hover:text-primary-400 transition-colors">
            {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current" />}
          </button>

          {/* Scrubber */}
          <div className="flex-1 relative h-6 flex items-center group cursor-pointer">
             <input 
               type="range" 
               min="0" 
               max="100" 
               step="0.1"
               value={progress}
               onChange={handleScrub}
               className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
             />
             <div className="w-full h-1.5 bg-white/30 rounded-full relative">
                <div 
                  className="absolute left-0 top-0 h-full bg-primary-500 rounded-full" 
                  style={{ width: `${progress}%` }} 
                />
                <div 
               className="absolute h-4 w-4 bg-white rounded-full shadow-lg pointer-events-none transition-transform group-hover:scale-125"
               style={{ 
                 left: `${progress}%`, 
                 top: '50%', 
                 marginTop: '-8px', 
                 transform: 'translateX(-50%)' 
               }}
             />
             </div>
          </div>

          {/* Mute */}
          <button onClick={() => { 
              if (videoRef.current) {
                videoRef.current.muted = !isMuted;
                setIsMuted(!isMuted);
              }
            }} 
            className="text-white hover:text-white/80"
          >
            {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}