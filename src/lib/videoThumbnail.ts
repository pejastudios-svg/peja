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