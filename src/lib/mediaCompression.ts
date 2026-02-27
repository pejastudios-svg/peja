import imageCompression from "browser-image-compression";

// =====================================================
// CONFIGURATION
// =====================================================
const CONFIG = {
  image: {
    maxSizeMB: 0.5, // 500KB
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: "image/jpeg",
  },
  video: {
    maxSizeMB: 16, // WhatsApp-style limit
    maxDurationMinutes: 5,
    cloudinaryCloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!,
    cloudinaryUploadPreset: process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!,
  },
};

// =====================================================
// IMAGE COMPRESSION (Client-side)
// =====================================================
export async function compressImage(
  file: File,
  onProgress?: (progress: number) => void
): Promise<File> {
  try {

    const compressed = await imageCompression(file, {
      ...CONFIG.image,
      onProgress: (progress) => {
        onProgress?.(progress);
      },
    });


    // Return as File with original name
    return new File([compressed], file.name, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (error) {
    throw new Error("Failed to compress image");
  }
}

// =====================================================
// VIDEO COMPRESSION (Cloudinary)
// =====================================================
export async function compressVideo(
  file: File,
  onProgress?: (progress: number) => void
): Promise<{ url: string; size: number; duration?: number }> {
  try {
    const originalSizeMB = file.size / 1024 / 1024;


    // Check if already under limit
    if (originalSizeMB <= CONFIG.video.maxSizeMB) {
      throw new Error("SKIP_COMPRESSION");
    }

    // Check duration
    const duration = await getVideoDuration(file);
    if (duration && duration > CONFIG.video.maxDurationMinutes * 60) {
      throw new Error(
        `Video too long. Maximum ${CONFIG.video.maxDurationMinutes} minutes allowed.`
      );
    }

    // If Cloudinary not configured, skip compression and upload directly
    if (!CONFIG.video.cloudinaryCloudName || !CONFIG.video.cloudinaryUploadPreset) {
      throw new Error("SKIP_COMPRESSION");
    }


    // Build FormData (transformation now comes from preset)
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CONFIG.video.cloudinaryUploadPreset);

    const xhr = new XMLHttpRequest();

    const uploadPromise = new Promise<{ url: string; size: number; duration?: number }>(
      (resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            onProgress?.(progress);
          }
        });

        xhr.addEventListener("load", () => {

          if (xhr.status === 200) {
            try {
              const response = JSON.parse(xhr.responseText);

              resolve({
                url: response.secure_url,
                size: response.bytes,
                duration: response.duration,
              });
            } catch (parseError) {
              reject(new Error("Invalid response from Cloudinary"));
            }
          } else {
            // Detailed error logging

            let errorMessage = `Upload failed with status ${xhr.status}`;

            try {
              const errorData = JSON.parse(xhr.responseText);
              if (errorData.error?.message) {
                errorMessage = `Cloudinary error: ${errorData.error.message}`;
              }
            } catch {}

            reject(new Error(errorMessage));
          }
        });

        xhr.addEventListener("error", () => {
          reject(new Error("Network error during upload"));
        });

        xhr.addEventListener("abort", () => {
          reject(new Error("Upload cancelled"));
        });

        const uploadUrl = `https://api.cloudinary.com/v1_1/${CONFIG.video.cloudinaryCloudName}/video/upload`;

        xhr.open("POST", uploadUrl);
        xhr.send(formData);
      }
    );

    return await uploadPromise;
  } catch (error: any) {
    if (error.message === "SKIP_COMPRESSION") {
      throw error; // Re-throw for caller to handle
    }
    throw new Error(error.message || "Failed to compress video");
  }
}

// =====================================================
// GET VIDEO DURATION (helper)
// =====================================================
function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";

    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };

    video.onerror = () => {
      reject(new Error("Failed to load video metadata"));
    };

    video.src = URL.createObjectURL(file);
  });
}

// =====================================================
// VALIDATE FILE
// =====================================================
export function validateMediaFile(file: File): {
  valid: boolean;
  error?: string;
} {
  const MAX_IMAGE_SIZE = 50 * 1024 * 1024;   // 50MB
  const MAX_VIDEO_SIZE = 100 * 1024 * 1024;  // 100MB
  const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024; // 25MB

  if (file.type.startsWith("image/")) {
    if (file.size > MAX_IMAGE_SIZE) {
      return {
        valid: false,
        error: `Image too large. Maximum ${MAX_IMAGE_SIZE / (1024 * 1024)}MB allowed.`,
      };
    }
  } else if (file.type.startsWith("video/")) {
    if (file.size > MAX_VIDEO_SIZE) {
      return {
        valid: false,
        error: `Video too large. Maximum ${MAX_VIDEO_SIZE / (1024 * 1024)}MB allowed.`,
      };
    }
  } else {
    if (file.size > MAX_DOCUMENT_SIZE) {
      return {
        valid: false,
        error: `File too large. Maximum ${MAX_DOCUMENT_SIZE / (1024 * 1024)}MB allowed.`,
      };
    }
  }

  return { valid: true };
}