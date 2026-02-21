"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Camera,
  Video,
  Image as ImageIcon,
  X,
  Loader2,
  Hash,
  ChevronLeft,
  AlertTriangle,
  Play,
  Shield,
  Eye,
  EyeOff,
  Upload,
  Crosshair,
  Flame,
  UserX,
  Skull,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/types";
import { notifyUsersAboutIncident } from "@/lib/notifications";

// Category icon mapping
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  crime: <AlertTriangle className="w-5 h-5" />,
  fire: <Flame className="w-5 h-5" />,
  kidnapping: <UserX className="w-5 h-5" />,
  terrorist: <Skull className="w-5 h-5" />,
  general: <Info className="w-5 h-5" />,
};

// Category color themes
const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  crime: { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", text: "#f87171", glow: "0 0 20px rgba(239,68,68,0.15)" },
  fire: { bg: "rgba(249,115,22,0.1)", border: "rgba(249,115,22,0.3)", text: "#fb923c", glow: "0 0 20px rgba(249,115,22,0.15)" },
  kidnapping: { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", text: "#f87171", glow: "0 0 20px rgba(239,68,68,0.15)" },
  terrorist: { bg: "rgba(220,38,38,0.15)", border: "rgba(220,38,38,0.4)", text: "#ef4444", glow: "0 0 20px rgba(220,38,38,0.2)" },
  general: { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.3)", text: "#60a5fa", glow: "0 0 20px rgba(59,130,246,0.15)" },
};

// Image compression utility
async function compressImage(file: File, maxWidth = 1920, quality = 0.8): Promise<File> {
  return new Promise((resolve) => {
    if (file.size < 500 * 1024) {
      resolve(file);
      return;
    }

    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      let { width, height } = img;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: "image/jpeg",
                lastModified: Date.now(),
              });
              resolve(compressedFile.size < file.size ? compressedFile : file);
            } else {
              resolve(file);
            }
          },
          "image/jpeg",
          quality
        );
      } else {
        resolve(file);
      }
    };

    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

function validateVideoSize(file: File): { valid: boolean; warning?: string } {
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    return {
      valid: true,
      warning: `Video is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Consider using a shorter clip for faster upload.`,
    };
  }
  return { valid: true };
}

export default function CreatePostPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const isMounted = useRef(true);

  const [media, setMedia] = useState<File[]>([]);
  const [mediaPreviews, setMediaPreviews] = useState<{ url: string; type: string }[]>([]);
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSensitive, setIsSensitive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number; address?: string } | null>(null);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      mediaPreviews.forEach(p => URL.revokeObjectURL(p.url));
    };
  }, []);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    } else if (!authLoading && user) {
      handleGetLocation();
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen pb-8">
        <div className="fixed top-0 left-0 right-0 z-40 glass-header">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        </div>
        <main className="pt-20 px-4 max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-12 w-full rounded-2xl" />
        </main>
      </div>
    );
  }

  if (!user) return null;

  const getAddressFromCoords = async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { headers: { "User-Agent": "Peja App" } }
      );
      const data = await response.json();
      if (data?.address) {
        const addr = data.address;
        const parts = [];
        if (addr.road) parts.push(addr.road);
        if (addr.neighbourhood) parts.push(addr.neighbourhood);
        if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village);
        if (addr.state) parts.push(addr.state);
        return parts.length > 0 ? parts.join(", ") : "Location found";
      }
      return "Location found";
    } catch {
      return "Location found";
    }
  };

  async function createVideoThumbnail(file: File): Promise<Blob | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.playsInline = true;

      const cleanup = () => URL.revokeObjectURL(url);

      video.addEventListener("loadeddata", async () => {
        try {
          video.currentTime = Math.min(0.2, video.duration || 0.2);
        } catch {}
      });

      video.addEventListener("seeked", () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 360;
          const ctx = canvas.getContext("2d");
          if (!ctx) { cleanup(); return resolve(null); }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => {
            cleanup();
            resolve(b || null);
          }, "image/jpeg", 0.8);
        } catch {
          cleanup();
          resolve(null);
        }
      });

      video.addEventListener("error", () => {
        cleanup();
        resolve(null);
      });
    });
  }

  const handleGetLocation = () => {
    setLocationLoading(true);
    setError("");

    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      setLocationLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (!isMounted.current) return;
        const { latitude, longitude } = position.coords;
        const address = await getAddressFromCoords(latitude, longitude);
        if (isMounted.current) {
          setLocation({ latitude, longitude, address });
          setLocationLoading(false);
        }
      },
      () => {
        if (isMounted.current) {
          setError("Could not get location. Please enable location services.");
          setLocationLoading(false);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    const currentPhotos = media.filter((m) => m.type.startsWith("image/")).length;
    const currentVideos = media.filter((m) => m.type.startsWith("video/")).length;
    const newPhotos = files.filter((f) => f.type.startsWith("image/")).length;
    const newVideos = files.filter((f) => f.type.startsWith("video/")).length;

    if (currentPhotos + newPhotos > 50) {
      setError("Maximum 50 photos");
      return;
    }

    if (currentVideos + newVideos > 10) {
      setError("Maximum 10 videos");
      return;
    }

    for (const file of files) {
      if (file.size > 100 * 1024 * 1024) {
        setError(`${file.name} is too large. Maximum 100MB per file.`);
        return;
      }
    }

    const newPreviews = files.map((file) => ({
      url: URL.createObjectURL(file),
      type: file.type.startsWith("video/") ? "video" : "image",
    }));

    setMedia((prev) => [...prev, ...files]);
    setMediaPreviews((prev) => [...prev, ...newPreviews]);
    setError("");
    e.target.value = "";
  };

  const handleRemoveMedia = (index: number) => {
    URL.revokeObjectURL(mediaPreviews[index].url);
    setMedia((prev) => prev.filter((_, i) => i !== index));
    setMediaPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddTag = () => {
    if (tagInput && tags.length < 10) {
      const newTag = tagInput.replace(/^#/, "").trim().toLowerCase();
      if (newTag && !tags.includes(newTag)) {
        setTags((prev) => [...prev, newTag]);
      }
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleSubmit = async () => {
  setError("");

  if (user?.status === "suspended") {
    setError("Your account is suspended. You can still receive alerts, but you cannot post.");
    return;
  }
  if (user?.status === "banned") {
    setError("Your account is banned.");
    return;
  }

  if (media.length === 0) {
    setError("Please add at least one photo or video");
    return;
  }

  if (!category) {
    setError("Please select a category");
    return;
  }

  if (!location) {
    setError("Location is required");
    return;
  }

  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

  if (authError || !authUser) {
    setError("Please sign in to post");
    router.push("/login");
    return;
  }

  setIsLoading(true);
  setUploadProgress(0);

  try {
    const mediaUrls: { url: string; type: "photo" | "video" }[] = [];
    const totalFiles = media.length;

    let done = 0;

    // Import compression utilities
    const { compressImage, compressVideo } = await import("@/lib/mediaCompression");

    for (let i = 0; i < totalFiles; i++) {
      const file = media[i];
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");

      let fileToUpload: File | null = null;
      let uploadToCloudinary = false;
      let cloudinaryUrl = "";

      try {
        // COMPRESS IMAGES
        if (isImage) {
          setToast("Processing image...");
          
          fileToUpload = await compressImage(file, (progress) => {
            const overallProgress = Math.round(
              ((i + progress / 100) / totalFiles) * 80
            );
            setUploadProgress(overallProgress);
          });

          console.log(`[Upload] Image compressed: ${(file.size / 1024).toFixed(0)}KB → ${(fileToUpload.size / 1024).toFixed(0)}KB`);
        }

        // COMPRESS VIDEOS
        if (isVideo) {
          const sizeMB = file.size / 1024 / 1024;

          if (sizeMB > 16) {
            setToast("Analyzing video...");

            try {
              const result = await compressVideo(file, (progress) => {
                const overallProgress = Math.round(
                  ((i + progress / 100) / totalFiles) * 80
                );
                setUploadProgress(overallProgress);
              });

              uploadToCloudinary = true;
              cloudinaryUrl = result.url;

              console.log("[Upload] Video compressed via Cloudinary:", {
                original: `${sizeMB.toFixed(2)}MB`,
                compressed: `${(result.size / 1024 / 1024).toFixed(2)}MB`,
                reduction: `${(((file.size - result.size) / file.size) * 100).toFixed(1)}%`,
              });
            } catch (error: any) {
              if (error.message !== "SKIP_COMPRESSION") {
                throw error;
              }
              // Video under 16MB, upload normally
              fileToUpload = file;
            }
          } else {
            // Video under 16MB, upload directly
            fileToUpload = file;
          }
        }

        // UPLOAD TO STORAGE
        let mediaUrl = "";

        if (uploadToCloudinary) {
          // Already uploaded to Cloudinary
          mediaUrl = cloudinaryUrl;
        } else if (fileToUpload) {
          // Upload to Supabase Storage
          const ext = fileToUpload.name.split(".").pop()?.toLowerCase() || (isVideo ? "mp4" : "jpg");
          const fileName = `posts/${authUser.id}/${Date.now()}-${Math.random()
            .toString(36)
            .substring(7)}.${ext}`;

          setToast(isVideo ? "Uploading video..." : "Uploading image...");

          const { error: uploadError } = await supabase.storage
            .from("media")
            .upload(fileName, fileToUpload, { cacheControl: "3600", upsert: false });

          if (uploadError) {
            throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
          }

          const { data: publicUrl } = supabase.storage.from("media").getPublicUrl(fileName);
          mediaUrl = publicUrl.publicUrl;
        }

        mediaUrls.push({
          url: mediaUrl,
          type: isVideo ? "video" : "photo",
        });

        done++;
        setUploadProgress(Math.round((done / totalFiles) * 80));
        setToast(null);

      } catch (error: any) {
        console.error("[Upload] Media processing error:", error);
        setError(error.message || "Failed to process media");
        setIsLoading(false);
        setUploadProgress(0);
        setToast(null);
        return;
      }
    }

    // REST OF THE FUNCTION STAYS THE SAME...
    setToast("Creating post...");

    const { data: post, error: postError } = await supabase
      .from("posts")
      .insert({
        user_id: authUser.id,
        category,
        comment: comment.trim() || null,
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.address || null,
        is_anonymous: false,
        is_sensitive: isSensitive,
        status: "live",
        confirmations: 0,
        views: 0,
        comment_count: 0,
        report_count: 0,
      })
      .select()
      .single();

    if (postError) {
      throw new Error(postError.message);
    }

    setUploadProgress(85);

    for (const mediaItem of mediaUrls) {
      await supabase.from("post_media").insert({
        post_id: post.id,
        url: mediaItem.url,
        media_type: mediaItem.type,
        is_sensitive: isSensitive,
      });
    }

    for (const tag of tags) {
      await supabase.from("post_tags").insert({
        post_id: post.id,
        tag,
      });
    }

    setUploadProgress(90);

    await supabase
      .from("users")
      .update({
        last_latitude: location.latitude,
        last_longitude: location.longitude,
        last_location_updated_at: new Date().toISOString(),
      })
      .eq("id", authUser.id);

    setUploadProgress(95);

    notifyUsersAboutIncident(
      post.id,
      authUser.id,
      category,
      location.address || null,
      location.latitude,
      location.longitude
    ).then(count => {
      console.log(`Notified ${count} users about new post`);
    }).catch(err => {
      console.error("Error notifying users:", err);
    });

    setUploadProgress(100);
    setToast("Post uploaded ✓");

    window.dispatchEvent(new Event("peja-post-created"));
    sessionStorage.setItem("peja-feed-refresh", "true");

    setTimeout(() => {
      const inOverlay = typeof window !== "undefined" && (window as any).__pejaOverlayOpen;
      if (inOverlay) router.back();
      else router.push("/");
    }, 650);

  } catch (err: any) {
    console.error("Submit error:", err);
    setError(err.message || "Something went wrong");
  } finally {
    setIsLoading(false);
    setUploadProgress(0);
    setToast(null);
  }
};

  const photoCount = media.filter(m => m.type.startsWith("image/")).length;
  const videoCount = media.filter(m => m.type.startsWith("video/")).length;
  const mediaCountText = media.length > 0
    ? `${photoCount > 0 ? `${photoCount} photo${photoCount > 1 ? "s" : ""}` : ""}${photoCount > 0 && videoCount > 0 ? ", " : ""}${videoCount > 0 ? `${videoCount} video${videoCount > 1 ? "s" : ""}` : ""}`
    : "0 files";

  return (
    <div className="min-h-screen pb-8">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 glass-header">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/5 rounded-lg">
            <ChevronLeft className="w-5 h-5 text-dark-200" />
          </button>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary-400" />
            <h1 className="font-semibold text-dark-50 text-sm">Report Incident</h1>
          </div>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-20 px-4 max-w-2xl mx-auto">
        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Upload Progress */}
        {isLoading && uploadProgress > 0 && (
          <div className="mb-4 p-4 rounded-xl bg-primary-500/10 border border-primary-500/20">
            <div className="flex justify-between mb-2">
              <span className="text-sm text-primary-400 font-medium">Uploading...</span>
              <span className="text-sm text-primary-400">{uploadProgress}%</span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%`, boxShadow: "0 0 10px rgba(139,92,246,0.5)" }}
              />
            </div>
          </div>
        )}

        {/* Media Upload */}
        <div className="glass-card mb-4">
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,video/*" multiple className="hidden" />
          <input type="file" ref={cameraInputRef} onChange={handleFileSelect} accept="image/*" capture="environment" className="hidden" />
          <input type="file" ref={videoInputRef} onChange={handleFileSelect} accept="video/*" capture="environment" className="hidden" />

          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary-400" />
              <span className="text-sm font-medium text-dark-200">Evidence</span>
            </div>
            <span className="text-xs text-dark-500">{mediaCountText}</span>
          </div>

          {/* Media previews */}
          {mediaPreviews.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mb-3">
              {mediaPreviews.map((preview, index) => (
                <div key={index} className="relative aspect-square rounded-xl overflow-hidden bg-dark-800">
                  {preview.type === "video" ? (
                    <div className="relative w-full h-full">
                      <video src={preview.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Play className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  ) : (
                    <img src={preview.url} alt="" className="w-full h-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveMedia(index)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center z-10"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Upload buttons */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="aspect-square rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all hover:scale-[1.02] active:scale-95"
              style={{
                background: "rgba(139, 92, 246, 0.08)",
                border: "1px dashed rgba(139, 92, 246, 0.3)",
              }}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(139, 92, 246, 0.15)" }}>
                <Camera className="w-5 h-5 text-primary-400" />
              </div>
              <span className="text-[10px] text-dark-400 font-medium">Photo</span>
            </button>

            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="aspect-square rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all hover:scale-[1.02] active:scale-95"
              style={{
                background: "rgba(139, 92, 246, 0.08)",
                border: "1px dashed rgba(139, 92, 246, 0.3)",
              }}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(139, 92, 246, 0.15)" }}>
                <Video className="w-5 h-5 text-primary-400" />
              </div>
              <span className="text-[10px] text-dark-400 font-medium">Video</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all hover:scale-[1.02] active:scale-95"
              style={{
                background: "rgba(139, 92, 246, 0.08)",
                border: "1px dashed rgba(139, 92, 246, 0.3)",
              }}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(139, 92, 246, 0.15)" }}>
                <ImageIcon className="w-5 h-5 text-primary-400" />
              </div>
              <span className="text-[10px] text-dark-400 font-medium">Gallery</span>
            </button>
          </div>
        </div>

        {/* Location */}
        <div className="glass-card mb-4">
          <button
            type="button"
            onClick={handleGetLocation}
            disabled={locationLoading}
            className="w-full flex items-center gap-3"
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: location ? "rgba(34, 197, 94, 0.15)" : "rgba(139, 92, 246, 0.15)",
                border: `1px solid ${location ? "rgba(34, 197, 94, 0.3)" : "rgba(139, 92, 246, 0.3)"}`,
              }}
            >
              {locationLoading ? (
                <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
              ) : (
                <Crosshair className={`w-5 h-5 ${location ? "text-green-400" : "text-primary-400"}`} />
              )}
            </div>
            <div className="flex-1 text-left min-w-0">
              {location ? (
                <>
                  <p className="text-sm text-dark-200 truncate">{location.address || "Location captured"}</p>
                  <p className="text-xs text-dark-500">{location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}</p>
                </>
              ) : (
                <p className="text-sm text-dark-400">{locationLoading ? "Getting location..." : "Tap to get location"}</p>
              )}
            </div>
            {location && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: "rgba(34,197,94,0.1)" }}>
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] text-green-400 font-medium">LIVE</span>
              </div>
            )}
          </button>
        </div>

        {/* Category */}
        <div className="glass-card mb-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-primary-400" />
            <span className="text-sm font-medium text-dark-200">Threat Level *</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((cat) => {
              const colors = CATEGORY_COLORS[cat.id] || CATEGORY_COLORS.general;
              const icon = CATEGORY_ICONS[cat.id] || <Info className="w-5 h-5" />;
              const isSelected = category === cat.id;

              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className="relative p-3 rounded-xl text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: isSelected ? colors.bg : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isSelected ? colors.border : "rgba(255,255,255,0.06)"}`,
                    boxShadow: isSelected ? colors.glow : "none",
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                      style={{
                        background: isSelected ? colors.bg : "rgba(255,255,255,0.04)",
                        color: isSelected ? colors.text : "#94a3b8",
                      }}
                    >
                      {icon}
                    </div>
                    <span
                      className="text-sm font-medium transition-colors"
                      style={{ color: isSelected ? colors.text : "#e2e8f0" }}
                    >
                      {cat.name}
                    </span>
                  </div>
                  {isSelected && (
                    <div
                      className="absolute top-2 right-2 w-2 h-2 rounded-full"
                      style={{ background: colors.text, boxShadow: `0 0 8px ${colors.text}` }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Description */}
        <div className="glass-card mb-4">
          <label className="block text-sm font-medium text-dark-200 mb-2">Description (Optional)</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What's happening?"
            rows={3}
            className="w-full px-4 py-3 glass-input resize-none text-base"
          />
        </div>

        {/* Tags */}
        <div className="mb-4">
          <div className="glass-card !p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Hash className="w-3.5 h-3.5 text-primary-400" />
              <span className="text-xs font-medium text-dark-300">Tags</span>
            </div>
            <div className="flex gap-2 mb-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Add tag"
                className="text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
              />
              <Button type="button" variant="secondary" size="sm" onClick={handleAddTag}>+</Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs max-w-full wrap-anywhere"
                    style={{
                      background: "rgba(124, 58, 237, 0.15)",
                      border: "1px solid rgba(139, 92, 246, 0.25)",
                      color: "#c4b5fd",
                    }}
                  >
                    #{tag}
                    <button type="button" onClick={() => handleRemoveTag(tag)}>
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sensitive Content Toggle */}
        <div className="glass-card mb-4">
          <button
            type="button"
            onClick={() => setIsSensitive(!isSensitive)}
            className="w-full flex items-center gap-3 transition-all active:scale-[0.98]"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all"
              style={{
                background: isSensitive ? "rgba(249, 115, 22, 0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${isSensitive ? "rgba(249, 115, 22, 0.3)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              {isSensitive ? (
                <EyeOff className="w-5 h-5 text-orange-400" />
              ) : (
                <Eye className="w-5 h-5 text-dark-500" />
              )}
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium" style={{ color: isSensitive ? "#fb923c" : "#e2e8f0" }}>
                {isSensitive ? "Sensitive Content" : "Safe Content"}
              </p>
              <p className="text-xs text-dark-500">
                Turn this on if the content contains blood, graphic injuries, or anything disturbing
              </p>
            </div>
            <div
              className="w-11 h-6 rounded-full relative transition-all shrink-0"
              style={{
                background: isSensitive ? "rgba(249, 115, 22, 0.5)" : "rgba(255,255,255,0.1)",
              }}
            >
              <div
                className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                style={{
                  left: isSensitive ? "calc(100% - 22px)" : "2px",
                  background: isSensitive ? "#fb923c" : "#64748b",
                }}
              />
            </div>
          </button>
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isLoading}
          className="w-full py-3.5 rounded-xl font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
          style={{
            background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
            boxShadow: "0 4px 20px rgba(124, 58, 237, 0.4), 0 0 40px rgba(124, 58, 237, 0.1)",
          }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Uploading... {uploadProgress}%
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <Shield className="w-5 h-5" />
              Post to Peja
            </div>
          )}
        </button>

        {toast && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2 rounded-xl glass-float text-dark-100">
            {toast}
          </div>
        )}
      </main>
    </div>
  );
}