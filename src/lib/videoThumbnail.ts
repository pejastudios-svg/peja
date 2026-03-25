/**
 * Derives a thumbnail JPG URL from a Cloudinary video URL.
 * Returns null for non-Cloudinary URLs.
 */
export function getVideoThumbnailUrl(videoUrl: string): string | null {
  if (
    !videoUrl ||
    !videoUrl.includes("res.cloudinary.com") ||
    !videoUrl.includes("/video/upload/")
  ) {
    return null;
  }

  try {
    const parts = videoUrl.split("/video/upload/");
    if (parts.length !== 2) return null;

    const base = parts[0];
    const rest = parts[1];

    const versionMatch = rest.match(/(v\d+\/.+)/);
    if (!versionMatch) return null;

    const pathWithVersion = versionMatch[1];
    const jpgPath = pathWithVersion.replace(/\.[^.]+$/, ".jpg");

    return `${base}/video/upload/so_0,w_480,h_480,c_limit,f_jpg,q_auto/${jpgPath}`;
  } catch {
    return null;
  }
}

/**
 * Returns a mobile-optimized Cloudinary video URL.
 * - Strips existing transformations
 * - Applies smaller resolution + lower quality for mobile
 * - Returns original URL for non-Cloudinary or desktop
 */
const isMobile =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export function getOptimizedVideoUrl(videoUrl: string): string {
  if (!videoUrl) return videoUrl;

  if (
    !videoUrl.includes("res.cloudinary.com") ||
    !videoUrl.includes("/video/upload/")
  ) {
    return videoUrl;
  }

  try {
    const parts = videoUrl.split("/video/upload/");
    if (parts.length !== 2) return videoUrl;

    const base = parts[0];
    const rest = parts[1];

    const versionMatch = rest.match(/(v\d+\/.+)/);
    if (!versionMatch) return videoUrl;

    const pathWithVersion = versionMatch[1];

    // Fast-start MP4: moov atom at beginning, h264 baseline for fast decode,
    // lower resolution on mobile for instant playback
    const width = isMobile ? 480 : 720;
    return `${base}/video/upload/w_${width},c_limit,q_auto:low,vc_h264:baseline,ac_aac,f_mp4,fl_fast_start/${pathWithVersion}`;
  } catch {
    return videoUrl;
  }
}

/**
 * Preloads the first chunk of a video URL so playback starts faster.
 * Call this when a video card enters the viewport.
 */
const preloadedUrls = new Set<string>();
const videoCache = new Map<string, string>(); // url -> blob URL

export function preloadVideoChunk(videoUrl: string, priority: "high" | "low" = "low"): void {
  if (typeof window === "undefined") return;
  if (preloadedUrls.has(videoUrl)) return;
  preloadedUrls.add(videoUrl);

  if (priority === "high") {
    // Full preload for first few videos - cache entire video as blob
    fetch(videoUrl, { mode: "cors", credentials: "omit" })
      .then(res => {
        if (!res.ok) return;
        return res.blob();
      })
      .then(blob => {
        if (blob) {
          const blobUrl = URL.createObjectURL(blob);
          videoCache.set(videoUrl, blobUrl);
        }
      })
      .catch(() => {});
  } else {
    // Range preload for later videos
    fetch(videoUrl, {
      headers: { Range: "bytes=0-5000000" },
      mode: "cors",
      credentials: "omit",
    }).catch(() => {});
  }
}

export function getCachedVideoUrl(videoUrl: string): string | null {
  return videoCache.get(videoUrl) || null;
}

export function preloadFeedVideos(posts: { media?: { url: string; media_type: string }[] }[]): void {
  if (typeof window === "undefined") return;
  
  let videoCount = 0;
  for (const post of posts) {
    const video = post.media?.find(m => m.media_type === "video");
    if (!video) continue;
    
    const optimizedUrl = getOptimizedVideoUrl(video.url);
    const priority = videoCount < 3 ? "high" : "low";
    preloadVideoChunk(optimizedUrl, priority);
    videoCount++;
    
    if (videoCount >= 6) break; // Preload max 6 videos
  }
}

/**
 * Converts a Cloudinary MP4 URL to HLS (.m3u8) for streaming.
 * Cloudinary generates HLS segments on-the-fly.
 * Returns null for non-Cloudinary URLs.
 */
export function getHlsUrl(videoUrl: string): string | null {
  if (
    !videoUrl ||
    !videoUrl.includes("res.cloudinary.com") ||
    !videoUrl.includes("/video/upload/")
  ) {
    return null;
  }

  try {
    const parts = videoUrl.split("/video/upload/");
    if (parts.length !== 2) return null;

    const base = parts[0];
    const rest = parts[1];

    const versionMatch = rest.match(/(v\d+\/.+)/);
    if (!versionMatch) return null;

    const pathWithVersion = versionMatch[1];
    const m3u8Path = pathWithVersion.replace(/\.[^.]+$/, ".m3u8");

    // Keep codec/quality, serve as HLS
    return `${base}/video/upload/vc_h264,ac_aac,q_auto/${m3u8Path}`;
  } catch {
    return null;
  }
}

/**
 * Generates a JPEG thumbnail from a video File or URL.
 * Returns a data URL string, or null on failure.
 * Works across Mac, iOS, and Android WebViews.
 */
export async function generateVideoThumbnail(
  source: File | string,
  maxWidth = 480
): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 10000);

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("muted", "");

    let blobUrl: string | null = null;
    let captured = false;

    const cleanup = () => {
      clearTimeout(timeout);
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {}
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
    };

    const captureFrame = (): boolean => {
      if (captured) return true;

      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        if (vw === 0 || vh === 0) return false;

        const scale = Math.min(1, maxWidth / vw);
        const cw = Math.round(vw * scale);
        const ch = Math.round(vh * scale);

        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;

        const ctx = canvas.getContext("2d");
        if (!ctx) return false;

        ctx.drawImage(video, 0, 0, cw, ch);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);

        // Verify it's not blank (very small data URL = blank frame)
        if (dataUrl.length < 1000) return false;

        captured = true;
        cleanup();
        resolve(dataUrl);
        return true;
      } catch (e) {
        return false;
      }
    };

    // Strategy: try to capture at 0.5s, fall back to first available frame
    video.onseeked = () => {
      // Wait a frame for the seek to render
      requestAnimationFrame(() => {
        setTimeout(() => {
          captureFrame();
        }, 50);
      });
    };

    video.onloadeddata = () => {
      // Try to seek to 0.5s for a meaningful frame
      try {
        const seekTo = Math.min(0.5, (video.duration || 1) * 0.1);
        if (isFinite(seekTo) && seekTo > 0 && isFinite(video.duration)) {
          video.currentTime = seekTo;
        } else {
          // Can't seek — try capturing first frame after delay
          setTimeout(() => {
            if (!captureFrame()) {
              // Last resort: try time 0
              video.currentTime = 0.01;
            }
          }, 200);
        }
      } catch {
        setTimeout(() => captureFrame(), 200);
      }
    };

    // Fallback for mobile: canplay fires more reliably than loadeddata in some WebViews
    video.oncanplay = () => {
      if (captured) return;
      // Give loadeddata/onseeked a chance first
      setTimeout(() => {
        if (!captured && video.readyState >= 2) {
          try {
            const seekTo = Math.min(0.5, (video.duration || 1) * 0.1);
            if (isFinite(seekTo) && seekTo > 0 && isFinite(video.duration)) {
              video.currentTime = seekTo;
            } else {
              captureFrame();
            }
          } catch {
            captureFrame();
          }
        }
      }, 500);
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    // Set source
    if (typeof source === "string") {
      // Only set crossOrigin for remote URLs, NOT blob URLs
      if (!source.startsWith("blob:") && !source.startsWith("data:")) {
        video.crossOrigin = "anonymous";
      }
      video.src = source;
    } else {
      blobUrl = URL.createObjectURL(source);
      video.src = blobUrl;
    }

    // Explicitly load
    video.load();

    // Mobile WebViews often need play() to trigger data loading
    // This must be in a user-gesture context (which it is — called from file input handler)
    setTimeout(() => {
      if (captured) return;
      try {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.then === "function") {
          playPromise
            .then(() => {
              video.pause();
              // If loadeddata/onseeked didn't fire yet, try capturing now
              setTimeout(() => {
                if (!captured) captureFrame();
              }, 300);
            })
            .catch(() => {
              // Autoplay blocked — loadeddata should still eventually fire
            });
        }
      } catch {
        // play() threw synchronously — fine, events should handle it
      }
    }, 100);
  });
}