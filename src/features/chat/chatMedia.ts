// Pre-upload pipeline for v2 chat attachments. Sits between the file
// picker and useSendMessage. Responsibilities, in order:
//
//   1. Reject files that exceed our size caps (50MB image / 100MB
//      video / 25MB document) with a friendly error.
//   2. Convert iPhone .heic / .heif images to JPEG so the recipient's
//      Chrome/Firefox can actually render them. iOS saves photos as
//      HEIC by default; Chrome and Firefox have no native decoder.
//   3. Compress images via browser-image-compression (longest edge to
//      1920px, JPEG quality target 500KB). The lib already exists in
//      `src/lib/mediaCompression.ts` and is used by post creation.
//   4. Compress videos via Cloudinary's transcoding upload preset.
//      Same lib as post creation. Returns a CDN-hosted URL we then
//      store in `message_media.url` (instead of uploading the raw
//      bytes to Supabase Storage).
//
// The processed result tells `useSendMessage` what to do next:
//   - For images: returns a compressed File. useSendMessage uploads
//     that File to Supabase Storage normally.
//   - For videos: returns a pre-uploaded URL (Cloudinary). No further
//     storage upload is needed; we skip straight to the message_media
//     insert.
//
// Why split this from useSendMessage? Two reasons:
//   a) The compression step is async and slow (videos can be 30+ s).
//      Keeping it separate makes it easy to surface progress + a
//      cancel handle to the UI.
//   b) Tests for the pipeline can run independently of the React + DB
//      surface in useSendMessage.

import {
  compressImage,
  compressVideo,
  validateMediaFile,
} from "@/lib/mediaCompression";

export type ProcessedAttachment =
  | {
      kind: "supabase";
      // The (possibly compressed) File ready to upload to Supabase
      // Storage. message_media stores the resulting public URL.
      file: File;
      // Video lands here only via the SKIP_COMPRESSION fallback (the
      // original is already small enough or Cloudinary isn't
      // configured). Image / audio / document are the typical paths.
      // Audio is here because voice notes are small enough that
      // Cloudinary transcoding isn't worth the round-trip.
      media_type: "image" | "video" | "audio" | "document";
      width?: number;
      height?: number;
    }
  | {
      kind: "preuploaded";
      // The file was uploaded externally (e.g. Cloudinary) and we have
      // its final URL already. Skip the Supabase Storage hop.
      url: string;
      file_name: string;
      mime_type: string;
      size: number;
      media_type: "video";
      width?: number;
      height?: number;
      duration?: number;
      thumbnail_url?: string;
    };

export interface ProcessProgress {
  // 0..1 — what fraction of THIS attachment's pre-upload work is done.
  // Compression is the main contributor; for videos this also covers
  // the Cloudinary upload.
  fraction: number;
  // Free-form label the UI can render alongside the ring ("Compressing
  // photo…", "Uploading video 35%", etc.). Optional.
  label?: string;
}

/**
 * Run the upstream pipeline (validate → HEIC convert → compress /
 * Cloudinary upload) for a single picked file. Reports progress through
 * the optional callback.
 *
 * Throws on validation failure or on a hard compression error so the
 * caller can surface a toast. SKIP_COMPRESSION (a sentinel thrown by
 * compressVideo when the original is small enough or Cloudinary isn't
 * configured) is caught here and treated as "upload the original."
 */
export async function processAttachment(
  file: File,
  onProgress?: (p: ProcessProgress) => void,
  abortSignal?: AbortSignal
): Promise<ProcessedAttachment> {
  // 1. Size cap. Throws a clear error the caller can toast.
  const v = validateMediaFile(file);
  if (!v.valid) throw new Error(v.error || "File rejected");

  // Caller may have cancelled before the pipeline even starts (e.g. the
  // user tapped X on the bubble while we were still building the
  // optimistic state). Bail out early so we don't waste time on HEIC
  // decode or compression for a send that's already been rolled back.
  if (abortSignal?.aborted) {
    throw new DOMException("aborted", "AbortError");
  }

  const type = mediaTypeFor(file);

  // 2. HEIC / HEIF — convert iPhone images to JPEG before anything
  //    else. Imports the converter lazily so the ~200KB lib doesn't
  //    weigh down the initial bundle for users who never touch HEIC.
  let working = file;
  if (isHeic(file)) {
    onProgress?.({ fraction: 0.1, label: "Converting iPhone photo…" });
    working = await heicToJpeg(file);
    if (abortSignal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
  }

  // 3. Type-specific compression.
  if (type === "image") {
    onProgress?.({ fraction: 0.2, label: "Compressing photo…" });
    const compressed = await compressImage(working, (frac) => {
      // imageCompression gives 0..100; scale into the 0.2..0.95 band
      // so the progress bar doesn't snap back to 0 after HEIC.
      onProgress?.({
        fraction: 0.2 + (frac / 100) * 0.75,
        label: "Compressing photo…",
      });
    });
    if (abortSignal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    onProgress?.({ fraction: 1, label: "Ready" });
    return { kind: "supabase", file: compressed, media_type: "image" };
  }

  if (type === "video") {
    onProgress?.({ fraction: 0.05, label: "Uploading video…" });
    try {
      const result = await compressVideo(
        working,
        (pct) => {
          // pct is 0..100 from Cloudinary's xhr.upload.onprogress.
          onProgress?.({
            fraction: 0.05 + (pct / 100) * 0.93,
            label: `Uploading video ${pct}%`,
          });
        },
        abortSignal
      );
      onProgress?.({ fraction: 1, label: "Ready" });
      return {
        kind: "preuploaded",
        // Apply delivery-time transformations so the URL we hand
        // recipients is already a smaller, browser-optimised variant.
        // First viewer triggers Cloudinary to transcode; cached after.
        // Derived independently from the poster URL (which uses a
        // different transformation chain), so each handles its own
        // optimisation.
        url: cloudinaryDeliveryUrl(result.url),
        file_name: file.name,
        mime_type: file.type || "video/mp4",
        size: result.size,
        media_type: "video",
        duration: result.duration,
        thumbnail_url: cloudinaryVideoPoster(result.url),
      };
    } catch (e) {
      // The lib throws "SKIP_COMPRESSION" as a sentinel when the video
      // is already small enough or Cloudinary isn't configured. Fall
      // back to uploading the original to Supabase Storage.
      if (e instanceof Error && e.message === "SKIP_COMPRESSION") {
        onProgress?.({ fraction: 1, label: "Ready" });
        return {
          kind: "supabase",
          file: working,
          media_type: "video",
        };
      }
      throw e;
    }
  }

  if (type === "audio") {
    // Voice notes are small (typically <1 MB at 60 s) — upload as-is
    // to Supabase Storage. No transcoding. media_type must stay
    // "audio" all the way through so the recipient's bubble routes
    // to the audio player; if we dropped to "document" here, the
    // message_media row would render as a blank chat bubble on the
    // other side.
    onProgress?.({ fraction: 1, label: "Ready" });
    return { kind: "supabase", file: working, media_type: "audio" };
  }

  // Documents / other — no compression, upload as-is.
  onProgress?.({ fraction: 1, label: "Ready" });
  return { kind: "supabase", file: working, media_type: "document" };
}

// =====================================================
// Helpers
// =====================================================

function mediaTypeFor(file: File): "image" | "video" | "audio" | "document" {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  return "document";
}

function isHeic(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t === "image/heic" || t === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

// Derive a JPEG poster URL from a Cloudinary video URL. Cloudinary's
// transformation syntax lets us request the first frame as an image by
// inserting `so_0` (start_offset=0) and swapping the extension. Same
// asset, no extra upload — Cloudinary generates it on demand.
//
// Returns null if the URL isn't a recognisable Cloudinary video URL,
// in which case the bubble falls back to the native <video> first
// frame (browser-rendered, slightly slower).
function cloudinaryVideoPoster(url: string): string | undefined {
  if (!url || !url.includes("/video/upload/")) return undefined;
  return url
    .replace("/video/upload/", "/video/upload/so_0/")
    .replace(/\.(mp4|webm|mov|m4v|mkv)(\?.*)?$/i, ".jpg$2");
}

// Delivery-side transformation chain we apply to every chat video URL
// before storing it in `message_media.url`. Cloudinary generates the
// transformed version on first request and caches it indefinitely, so
// only the first viewer pays the transcode cost — everyone after gets
// the CDN-cached, smaller file. Components:
//
//   q_auto:eco   — auto-quality, optimised for size over fidelity.
//                  Visually fine for chat at typical viewing sizes.
//   f_auto       — auto format. Modern browsers get AV1/H.265/WebM
//                  (smaller), older ones fall back to H.264.
//   c_limit,h_720 — cap height at 720p. Larger inputs are downscaled;
//                  smaller inputs are left alone (c_limit doesn't
//                  enlarge). Halves bytes for the common 1080p case.
//
// If you want a smaller / larger ceiling later, change the `h_720`
// number. 480p is more aggressive but obvious quality loss on phones
// held landscape; 1080p means roughly 4× the bytes of 720p with no
// perceptible benefit on mobile screens.
const CLOUDINARY_VIDEO_DELIVERY_TRANSFORM = "q_auto:eco,f_auto,c_limit,h_720";

function cloudinaryDeliveryUrl(url: string): string {
  if (!url || !url.includes("/video/upload/")) return url;
  return url.replace(
    "/video/upload/",
    `/video/upload/${CLOUDINARY_VIDEO_DELIVERY_TRANSFORM}/`
  );
}

async function heicToJpeg(file: File): Promise<File> {
  // Lazy import — the converter is heavy and most sessions never need it.
  const { default: heic2any } = await import("heic2any");
  const blob = (await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.85,
  })) as Blob;
  const newName = file.name.replace(/\.heic|\.heif$/i, ".jpg");
  return new File([blob], newName, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}
