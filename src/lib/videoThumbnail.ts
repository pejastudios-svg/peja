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