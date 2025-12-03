"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Video,
  Image as ImageIcon,
  MapPin,
  X,
  Loader2,
  Hash,
  ChevronLeft,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/types";

export default function CreatePostPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [media, setMedia] = useState<File[]>([]);
  const [mediaPreviews, setMediaPreviews] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
    address?: string;
  } | null>(null);
  const [error, setError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!authLoading && user) {
      handleGetLocation();
    }
  }, [authLoading, user]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Reverse geocode to get address from coordinates
  const getAddressFromCoords = async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'Peja App'
          }
        }
      );
      const data = await response.json();
      
      if (data && data.address) {
        const addr = data.address;
        // Build a readable address
        const parts = [];
        if (addr.road) parts.push(addr.road);
        if (addr.neighbourhood) parts.push(addr.neighbourhood);
        if (addr.suburb) parts.push(addr.suburb);
        if (addr.city || addr.town || addr.village) {
          parts.push(addr.city || addr.town || addr.village);
        }
        if (addr.state) parts.push(addr.state);
        
        return parts.length > 0 ? parts.join(", ") : data.display_name || "Location found";
      }
      return "Location found";
    } catch (error) {
      console.error("Geocoding error:", error);
      return "Location found";
    }
  };

  const handleGetLocation = () => {
    setLocationLoading(true);
    setError("");

    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      setLocationLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        
        // Get the actual address
        const address = await getAddressFromCoords(latitude, longitude);
        
        setLocation({ latitude, longitude, address });
        setLocationLoading(false);
      },
      (err) => {
        console.error("Location error:", err);
        setError("Could not get your location. Please enable location services.");
        setLocationLoading(false);
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
      setError("Maximum 50 photos allowed");
      return;
    }

    if (currentVideos + newVideos > 10) {
      setError("Maximum 10 videos allowed");
      return;
    }

    const newPreviews = files.map((file) => URL.createObjectURL(file));
    setMedia((prev) => [...prev, ...files]);
    setMediaPreviews((prev) => [...prev, ...newPreviews]);
    setError("");
  };

  const handleRemoveMedia = (index: number) => {
    URL.revokeObjectURL(mediaPreviews[index]);
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

    if (media.length === 0) {
      setError("Please add at least one photo or video");
      return;
    }

    if (!category) {
      setError("Please select a category");
      return;
    }

    if (!location) {
      setError("Location is required. Please enable location services.");
      return;
    }

    setIsLoading(true);

    try {
      const mediaUrls: { url: string; type: "photo" | "video" }[] = [];

      for (const file of media) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `posts/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("media")
          .upload(filePath, file);

        if (uploadError) {
          throw new Error(`Failed to upload: ${uploadError.message}`);
        }

        const { data: publicUrl } = supabase.storage
          .from("media")
          .getPublicUrl(filePath);

        mediaUrls.push({
          url: publicUrl.publicUrl,
          type: file.type.startsWith("video/") ? "video" : "photo",
        });
      }

      const userId = (await supabase.auth.getUser()).data.user?.id;

      const postData = {
        user_id: userId,
        category,
        comment: comment || null,
        location: `POINT(${location.longitude} ${location.latitude})`,
        address: location.address || null,
        is_anonymous: isAnonymous,
        status: "live",
        is_sensitive: false,
        confirmations: 0,
        views: 0,
      };

      const { data: post, error: postError } = await supabase
        .from("posts")
        .insert(postData)
        .select()
        .single();

      if (postError) {
        throw new Error(`Failed to create post: ${postError.message}`);
      }

      for (const mediaItem of mediaUrls) {
        await supabase.from("post_media").insert({
          post_id: post.id,
          url: mediaItem.url,
          media_type: mediaItem.type,
          is_sensitive: false,
        });
      }

      for (const tag of tags) {
        await supabase.from("post_tags").insert({
          post_id: post.id,
          tag,
        });
      }

      router.push("/");
    } catch (err) {
      console.error("Submit error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen pb-8">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="font-semibold text-dark-50">Report Incident</h1>
          <div className="w-9" />
        </div>
      </header>

      <main className="pt-20 px-4 max-w-2xl mx-auto">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Media Upload */}
        <div className="glass-card mb-4">
          <label className="block text-sm font-medium text-dark-200 mb-3">
            Photos / Videos
          </label>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*,video/*"
            multiple
            className="hidden"
          />
          <input
            type="file"
            ref={cameraInputRef}
            onChange={handleFileSelect}
            accept="image/*"
            capture="environment"
            className="hidden"
          />
          <input
            type="file"
            ref={videoInputRef}
            onChange={handleFileSelect}
            accept="video/*"
            capture="environment"
            className="hidden"
          />

          <div className="grid grid-cols-4 gap-2">
            {mediaPreviews.map((preview, index) => (
              <div
                key={index}
                className="relative aspect-square rounded-lg overflow-hidden bg-dark-800"
              >
                {media[index].type.startsWith("video/") ? (
                  <video src={preview} className="w-full h-full object-cover" />
                ) : (
                  <img src={preview} alt="" className="w-full h-full object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveMedia(index)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            ))}

            {media.length < 50 && (
              <>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-dark-600 flex flex-col items-center justify-center hover:border-primary-500/50 hover:bg-primary-500/5 transition-colors"
                >
                  <Camera className="w-6 h-6 text-dark-400 mb-1" />
                  <span className="text-xs text-dark-400">Camera</span>
                </button>

                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-dark-600 flex flex-col items-center justify-center hover:border-primary-500/50 hover:bg-primary-500/5 transition-colors"
                >
                  <Video className="w-6 h-6 text-dark-400 mb-1" />
                  <span className="text-xs text-dark-400">Video</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-dark-600 flex flex-col items-center justify-center hover:border-primary-500/50 hover:bg-primary-500/5 transition-colors"
                >
                  <ImageIcon className="w-6 h-6 text-dark-400 mb-1" />
                  <span className="text-xs text-dark-400">Gallery</span>
                </button>
              </>
            )}
          </div>

          <p className="text-xs text-dark-500 mt-2">
            Up to 50 photos, 10 videos (3 min each)
          </p>
        </div>

        {/* Location */}
        <div className="glass-card mb-4">
          <label className="block text-sm font-medium text-dark-200 mb-3">
            Location
          </label>
          <button
            type="button"
            onClick={handleGetLocation}
            disabled={locationLoading}
            className="w-full flex items-center gap-3 p-3 rounded-xl glass-sm hover:bg-white/10 transition-colors text-left"
          >
            {locationLoading ? (
              <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
            ) : (
              <MapPin className="w-5 h-5 text-primary-400" />
            )}
            <div className="flex-1 min-w-0">
              {location ? (
                <>
                  <p className="text-sm text-dark-200 truncate">
                    {location.address || "Location captured"}
                  </p>
                  <p className="text-xs text-dark-500">
                    {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-dark-400">
                  {locationLoading ? "Getting location..." : "Tap to get location"}
                </p>
              )}
            </div>
          </button>
        </div>

        {/* Category */}
        <div className="glass-card mb-4">
          <label className="block text-sm font-medium text-dark-200 mb-3">
            Category
          </label>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                className={`p-3 rounded-xl text-left transition-all ${
                  category === cat.id
                    ? "bg-primary-600/20 border border-primary-500/50"
                    : "glass-sm hover:bg-white/10"
                }`}
              >
                <span className="text-sm font-medium text-dark-200">
                  {cat.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="glass-card mb-4">
          <label className="block text-sm font-medium text-dark-200 mb-3">
            Description (Optional)
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What's happening?"
            rows={3}
            className="glass-input resize-none"
            style={{ paddingLeft: "1rem", paddingRight: "1rem" }}
          />
        </div>

        {/* Tags */}
        <div className="glass-card mb-4">
          <label className="block text-sm font-medium text-dark-200 mb-3">
            Tags (Optional)
          </label>
          <div className="flex gap-2 mb-2">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Add a tag"
              leftIcon={<Hash className="w-4 h-4" />}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={handleAddTag}>
              Add
            </Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary-600/20 text-primary-400 text-sm"
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Anonymous Toggle */}
        <div className="glass-card mb-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
              className="w-5 h-5 rounded border-dark-600 bg-dark-800 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-dark-200">Post anonymously</span>
          </label>
          <p className="text-xs text-dark-500 mt-2 ml-8">
            Your identity will be hidden from other users
          </p>
        </div>

        {/* Submit Button */}
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={handleSubmit}
          isLoading={isLoading}
        >
          Post to Peja
        </Button>
      </main>
    </div>
  );
}