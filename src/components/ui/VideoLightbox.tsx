"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Play, Pause, Volume2, VolumeX } from "lucide-react";
import { useAudio } from "@/context/AudioContext";
import { supabase } from "@/lib/supabase";

export function VideoLightbox({
  isOpen,
  onClose,
  videoUrl,
  startTime = 0,
  postId,
  posterUrl,
}: {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string | null;
  startTime?: number;
  postId?: string;
  posterUrl?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewedRef = useRef<Set<string>>(new Set());

const incrementView = async (id: string) => {
  // Prevent duplicate views in this session
  if (viewedRef.current.has(id)) return;
  viewedRef.current.add(id);
  
  try {
    // Get current view count
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
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  
  // Use global audio context instead of local state
  const { soundEnabled, setSoundEnabled } = useAudio();
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  
  const fadeTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen) {
      setVideoReady(false);
      setShowControls(true);
      setIsPlaying(true);
      resetFadeTimer();
      document.body.style.overflow = "hidden";
      window.dispatchEvent(new Event("peja-modal-open"));

          if (postId) {
      incrementView(postId);
    }
      
      const v = videoRef.current;
      if (v && startTime > 0) {
        const setTime = () => {
          v.currentTime = startTime;
          v.removeEventListener("loadedmetadata", setTime);
        };
        if (v.readyState >= 1) {
          v.currentTime = startTime;
        } else {
          v.addEventListener("loadedmetadata", setTime);
        }
      }
    } else {
      document.body.style.overflow = "";
      setDragOffset({ x: 0, y: 0 });
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
      window.dispatchEvent(new Event("peja-modal-close"));
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen, startTime, postId]);

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
      onClose();
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
  if (target.closest('button')) return;
  setSoundEnabled(true);
}}
onTouchStartCapture={(e) => {
  const target = e.target as HTMLElement;
  if (target.closest('button')) return;
  setSoundEnabled(true);
}}
    >
      <div 
        className="absolute inset-0 bg-black transition-opacity duration-100 ease-linear"
        style={{ opacity: bgOpacity }}
      />

      <div className={`absolute top-4 left-4 z-10 transition-opacity duration-300 opacity-0 group-hover:opacity-100 ${showControls ? 'opacity-100!' : 'pointer-events-none'}`}>
        <button 
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="p-2 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      </div>

      <div className="absolute inset-0 z-5" onClick={handleScreenTap} />

      <div className="relative z-1 w-full h-full flex items-center justify-center transition-transform duration-200 ease-out"
        style={{ 
          transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(${1 - dragDistance / 1000})`,
          transition: isDragging ? 'none' : 'transform 0.3s ease-out' 
        }}
      >
        {/* Poster image shown until video is actually playing */}
        {posterUrl && !videoReady && (
          <img
            src={posterUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[1]"
          />
        )}
        <video
  ref={videoRef}
  src={videoUrl}
  poster={posterUrl || undefined}
  className="max-w-full max-h-full w-full h-full object-contain pointer-events-none"
  playsInline
  autoPlay
  preload="auto"
  muted={!soundEnabled}
  onTimeUpdate={handleTimeUpdate}
  onPlaying={() => setVideoReady(true)}
  onEnded={() => setIsPlaying(false)}
  onCanPlay={() => {
    const v = videoRef.current;
    if (v && startTime > 0 && v.currentTime < startTime) {
      v.currentTime = startTime;
    }
  }}
/>
      </div>

      <div 
        className={`absolute bottom-0 inset-x-0 p-6 bg-linear-to-t from-black/90 via-black/50 to-transparent z-10 transition-all duration-300 opacity-0 group-hover:opacity-100 ${showControls && !isDragging ? 'opacity-100! pointer-events-auto' : 'pointer-events-none opacity-0!'}`}
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