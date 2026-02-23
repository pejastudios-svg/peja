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
    !isMobile ||
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

    // Find the version segment (v followed by digits)
    const versionMatch = rest.match(/(v\d+\/.+)/);
    if (!versionMatch) return videoUrl;

    const pathWithVersion = versionMatch[1];

    // Mobile: 640px wide, auto height, h264, good quality, fast-start mp4
    return `${base}/video/upload/w_640,c_limit,q_auto:good,vc_h264,ac_aac,f_mp4,fl_streaming_attachment/${pathWithVersion}`;
  } catch {
    return videoUrl;
  }
}

/**
 * Preloads the first chunk of a video URL so playback starts faster.
 * Call this when a video card enters the viewport.
 */
export function preloadVideoChunk(videoUrl: string): void {
  if (typeof window === "undefined") return;

  try {
    fetch(videoUrl, {
      headers: { Range: "bytes=0-500000" }, // ~500KB — enough for moov atom + first frames
      mode: "cors",
      credentials: "omit",
    }).catch(() => {});
  } catch {}
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
 * Seeks to 0.5s for a meaningful frame (not a black first frame).
 */
export async function generateVideoThumbnail(
  source: File | string,
  maxWidth = 480
): Promise<string | null> {
  return new Promise((resolve) => {
    // Timeout: if thumbnail generation takes too long, skip it
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    let blobUrl: string | null = null;

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
    };

    video.onloadeddata = () => {
      // Seek to 0.5s or 10% of duration for a better frame
      const seekTo = Math.min(0.5, video.duration * 0.1);
      video.currentTime = seekTo;
    };

    video.onseeked = () => {
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        if (vw === 0 || vh === 0) {
          cleanup();
          resolve(null);
          return;
        }

        const scale = Math.min(1, maxWidth / vw);
        const cw = Math.round(vw * scale);
        const ch = Math.round(vh * scale);

        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }

        ctx.drawImage(video, 0, 0, cw, ch);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);

        cleanup();

        // Verify it's not a blank/empty image (very small data URL = blank)
        if (dataUrl.length < 1000) {
          resolve(null);
          return;
        }

        resolve(dataUrl);
      } catch (e) {
        console.log("[generateVideoThumbnail] Canvas error:", e);
        cleanup();
        resolve(null);
      }
    };

    video.onerror = () => {
      console.log("[generateVideoThumbnail] Video load error");
      cleanup();
      resolve(null);
    };

    if (typeof source === "string") {
      video.src = source;
    } else {
      blobUrl = URL.createObjectURL(source);
      video.src = blobUrl;
    }
  });
}