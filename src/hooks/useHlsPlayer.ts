"use client";

import { useEffect } from "react";

/**
 * Simplified video loader — NO HLS.
 * 
 * For short social videos (< 5 min), MP4 with range requests
 * is faster than HLS because it skips the manifest download.
 * 
 * This hook is now a no-op kept for compatibility.
 * Videos use their optimized MP4 URL directly via src attribute.
 */
export function useHlsPlayer(
  _videoRef: React.RefObject<HTMLVideoElement | null>,
  _src: string,
  _active: boolean = true
) {
  // Intentionally empty — MP4 direct playback is faster for short videos.
  // The video element's src attribute handles everything.
}