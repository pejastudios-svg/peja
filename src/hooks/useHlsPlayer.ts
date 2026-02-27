"use client";

import { useEffect, useRef } from "react";
import Hls from "hls.js";
import { getHlsUrl, getOptimizedVideoUrl } from "@/lib/videoThumbnail";

/**
 * Attaches HLS streaming to a <video> element when possible.
 * Falls back to MP4 automatically if HLS fails.
 * 
 * The video element should still have src={mp4Url} as default —
 * this hook REPLACES it with HLS when available.
 */
export function useHlsPlayer(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string,
  active: boolean = true
) {
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !src || !video) return;

    // Cleanup previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const hlsUrl = getHlsUrl(src);
    if (!hlsUrl) return; // Not a Cloudinary URL — keep existing MP4 src

    const mp4Fallback = getOptimizedVideoUrl(src);

    // Safari / iOS WebView: native HLS support
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;

      const onError = () => {
        video.src = mp4Fallback;
      };
      video.addEventListener("error", onError, { once: true });

      return () => {
        video.removeEventListener("error", onError);
      };
    }

    // Chrome / Android WebView: use hls.js
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        startLevel: -1, // auto quality selection
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          hls.destroy();
          hlsRef.current = null;
          video.src = mp4Fallback;
        }
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    // No HLS support at all — keep existing MP4 src on the video element
  }, [src, active]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, []);
}