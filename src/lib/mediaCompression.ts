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
    console.log("[MediaCompression] Starting image compression:", {
      originalSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      name: file.name,
    });

    const compressed = await imageCompression(file, {
      ...CONFIG.image,
      onProgress: (progress) => {
        onProgress?.(progress);
      },
    });

    console.log("[MediaCompression] Image compressed:", {
      originalSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      compressedSize: `${(compressed.size / 1024 / 1024).toFixed(2)} MB`,
      reduction: `${(((file.size - compressed.size) / file.size) * 100).toFixed(1)}%`,
    });

    // Return as File with original name
    return new File([compressed], file.name, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (error) {
    console.error("[MediaCompression] Image compression failed:", error);
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

    console.log("[MediaCompression] Starting video upload:", {
      originalSize: `${originalSizeMB.toFixed(2)} MB`,
      name: file.name,
      type: file.type,
    });

    // Check if already under limit
    if (originalSizeMB <= CONFIG.video.maxSizeMB) {
      console.log("[MediaCompression] Video already under size limit, skipping compression");
      throw new Error("SKIP_COMPRESSION");
    }

    // Check duration
    const duration = await getVideoDuration(file);
    if (duration && duration > CONFIG.video.maxDurationMinutes * 60) {
      throw new Error(
        `Video too long. Maximum ${CONFIG.video.maxDurationMinutes} minutes allowed.`
      );
    }

    // Validate Cloudinary config
    if (!CONFIG.video.cloudinaryCloudName) {
      throw new Error("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME is not set");
    }
    if (!CONFIG.video.cloudinaryUploadPreset) {
      throw new Error("NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET is not set");
    }

    console.log("[MediaCompression] Cloudinary config:", {
      cloudName: CONFIG.video.cloudinaryCloudName,
      uploadPreset: CONFIG.video.cloudinaryUploadPreset,
    });

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
            console.log(`[Cloudinary] Upload progress: ${progress}%`);
            onProgress?.(progress);
          }
        });

        xhr.addEventListener("load", () => {
          console.log("[Cloudinary] Response received:", {
            status: xhr.status,
            statusText: xhr.statusText,
          });

          if (xhr.status === 200) {
            try {
              const response = JSON.parse(xhr.responseText);
              console.log("[Cloudinary] Upload success:", {
                url: response.secure_url,
                originalBytes: file.size,
                compressedBytes: response.bytes,
                reduction: `${(((file.size - response.bytes) / file.size) * 100).toFixed(1)}%`,
                duration: response.duration,
                format: response.format,
              });

              resolve({
                url: response.secure_url,
                size: response.bytes,
                duration: response.duration,
              });
            } catch (parseError) {
              console.error("[Cloudinary] JSON parse error:", parseError);
              console.error("[Cloudinary] Raw response:", xhr.responseText);
              reject(new Error("Invalid response from Cloudinary"));
            }
          } else {
            // Detailed error logging
            console.error("[Cloudinary] Upload failed:", {
              status: xhr.status,
              statusText: xhr.statusText,
              responseText: xhr.responseText,
            });

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
          console.error("[Cloudinary] Network error during upload");
          reject(new Error("Network error during upload"));
        });

        xhr.addEventListener("abort", () => {
          console.error("[Cloudinary] Upload cancelled by user");
          reject(new Error("Upload cancelled"));
        });

        const uploadUrl = `https://api.cloudinary.com/v1_1/${CONFIG.video.cloudinaryCloudName}/video/upload`;
        console.log("[Cloudinary] Uploading to:", uploadUrl);

        xhr.open("POST", uploadUrl);
        xhr.send(formData);
      }
    );

    return await uploadPromise;
  } catch (error: any) {
    if (error.message === "SKIP_COMPRESSION") {
      throw error; // Re-throw for caller to handle
    }
    console.error("[MediaCompression] Video compression failed:", error);
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
  const maxSize = 100 * 1024 * 1024; // 100MB

  if (file.size > maxSize) {
    return {
      valid: false,
      error: "File too large. Maximum 100MB allowed.",
    };
  }

  if (file.type.startsWith("video/")) {
    // Additional video validations can go here
  }

  if (file.type.startsWith("image/")) {
    // Additional image validations can go here
  }

  return { valid: true };
}