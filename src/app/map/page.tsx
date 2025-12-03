"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES } from "@/lib/types";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Sidebar } from "@/components/layout/Sidebar";
import { Badge } from "@/components/ui/Badge";
import {
  Loader2,
  MapPin,
  Navigation,
  List,
  Map as MapIcon,
  X,
  Clock,
  CheckCircle,
  ChevronUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// Dynamically import the map component (Leaflet doesn't work with SSR)
const IncidentMap = dynamic(() => import("@/components/map/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center bg-dark-800">
      <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
    </div>
  ),
});

export default function MapPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [showList, setShowList] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [gettingLocation, setGettingLocation] = useState(false);

  useEffect(() => {
    getUserLocation();
    fetchPosts();
  }, []);

  const getUserLocation = () => {
    setGettingLocation(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setGettingLocation(false);
        },
        (error) => {
          console.error("Location error:", error);
          setGettingLocation(false);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setGettingLocation(false);
    }
  };

  const fetchPosts = async () => {
    try {
      const { data, error } = await supabase
        .from("posts")
        .select(`
          *,
          post_media (*)
        `)
        .eq("status", "live")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const formattedPosts: Post[] = (data || []).map((post) => ({
        id: post.id,
        user_id: post.user_id,
        category: post.category,
        comment: post.comment,
        location: { latitude: 0, longitude: 0 },
        address: post.address,
        is_anonymous: post.is_anonymous,
        status: post.status,
        is_sensitive: post.is_sensitive,
        confirmations: post.confirmations || 0,
        views: post.views || 0,
        created_at: post.created_at,
        media: post.post_media || [],
        tags: [],
      }));

      setPosts(formattedPosts);
    } catch (error) {
      console.error("Error fetching posts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePostClick = (postId: string) => {
    router.push(`/post/${postId}`);
  };

  const filteredPosts = selectedCategory
    ? posts.filter((p) => p.category === selectedCategory)
    : posts;

  const categoryColors: Record<string, string> = {
    danger: "bg-red-500",
    warning: "bg-orange-500",
    awareness: "bg-yellow-500",
    info: "bg-blue-500",
  };

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header
        onMenuClick={() => setSidebarOpen(true)}
        onCreateClick={() => router.push("/create")}
      />

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="pt-16 lg:pl-64 h-screen">
        <div className="relative h-[calc(100vh-8rem)] lg:h-[calc(100vh-4rem)]">
          {/* Map */}
          {loading ? (
            <div className="h-full flex items-center justify-center bg-dark-800">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            </div>
          ) : (
            <IncidentMap
              posts={filteredPosts}
              userLocation={userLocation}
              onPostClick={handlePostClick}
            />
          )}

          {/* Category Filters - Floating on top of map */}
          <div className="absolute top-4 left-4 right-4 z-[1000]">
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap shadow-lg transition-colors ${
                  !selectedCategory
                    ? "bg-primary-600 text-white"
                    : "bg-dark-800/90 backdrop-blur text-dark-200"
                }`}
              >
                All ({posts.length})
              </button>
              
              {(["danger", "warning", "awareness", "info"] as const).map((color) => {
                const categoryGroup = CATEGORIES.filter((c) => c.color === color);
                const count = posts.filter((p) =>
                  categoryGroup.some((c) => c.id === p.category)
                ).length;

                if (count === 0) return null;

                const colorStyles = {
                  danger: "bg-red-500/90 text-white",
                  warning: "bg-orange-500/90 text-white",
                  awareness: "bg-yellow-500/90 text-black",
                  info: "bg-blue-500/90 text-white",
                };

                const label = {
                  danger: "🔴 Danger",
                  warning: "🟠 Caution",
                  awareness: "🟡 Awareness",
                  info: "🔵 Info",
                };

                return (
                  <button
                    key={color}
                    onClick={() => setSelectedCategory(
                      selectedCategory === categoryGroup[0]?.id ? null : categoryGroup[0]?.id
                    )}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap shadow-lg backdrop-blur ${colorStyles[color]}`}
                  >
                    {label[color]} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* My Location Button */}
          <button
            onClick={getUserLocation}
            disabled={gettingLocation}
            className="absolute bottom-24 right-4 z-[1000] p-3 bg-dark-800/90 backdrop-blur rounded-full shadow-lg"
          >
            {gettingLocation ? (
              <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
            ) : (
              <Navigation className="w-5 h-5 text-primary-400" />
            )}
          </button>

          {/* Toggle List View Button */}
          <button
            onClick={() => setShowList(!showList)}
            className="absolute bottom-24 left-4 z-[1000] p-3 bg-dark-800/90 backdrop-blur rounded-full shadow-lg"
          >
            {showList ? (
              <MapIcon className="w-5 h-5 text-primary-400" />
            ) : (
              <List className="w-5 h-5 text-primary-400" />
            )}
          </button>

          {/* Bottom Sheet List */}
          <div
            className={`absolute bottom-0 left-0 right-0 z-[1000] bg-dark-900/95 backdrop-blur rounded-t-2xl shadow-2xl transition-transform duration-300 ${
              showList ? "translate-y-0" : "translate-y-[calc(100%-60px)]"
            }`}
            style={{ maxHeight: "60%" }}
          >
            {/* Handle */}
            <button
              onClick={() => setShowList(!showList)}
              className="w-full py-3 flex flex-col items-center"
            >
              <div className="w-10 h-1 bg-dark-600 rounded-full mb-1" />
              <div className="flex items-center gap-1 text-sm text-dark-400">
                <ChevronUp className={`w-4 h-4 transition-transform ${showList ? "rotate-180" : ""}`} />
                {filteredPosts.length} incidents
              </div>
            </button>

            {/* List */}
            <div className="overflow-y-auto px-4 pb-4" style={{ maxHeight: "calc(60vh - 60px)" }}>
              <div className="space-y-3">
                {filteredPosts.map((post) => {
                  const category = CATEGORIES.find((c) => c.id === post.category);
                  const badgeVariant =
                    category?.color === "danger"
                      ? "danger"
                      : category?.color === "warning"
                      ? "warning"
                      : "info";

                  return (
                    <div
                      key={post.id}
                      onClick={() => router.push(`/post/${post.id}`)}
                      className="flex gap-3 p-3 glass-sm rounded-xl cursor-pointer hover:bg-white/5"
                    >
                      {post.media?.[0] && (
                        <img
                          src={post.media[0].url}
                          alt=""
                          className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={badgeVariant}>
                            {category?.name || post.category}
                          </Badge>
                          {post.status === "live" && (
                            <span className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                              <span className="text-xs text-red-400">LIVE</span>
                            </span>
                          )}
                        </div>
                        {post.comment && (
                          <p className="text-sm text-dark-200 line-clamp-1 mb-1">
                            {post.comment}
                          </p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-dark-400">
                          {post.address && (
                            <span className="flex items-center gap-1 truncate max-w-[150px]">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              {post.address}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="absolute top-20 right-4 z-[1000] glass-sm rounded-lg p-2 text-xs space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-500 rounded-full" />
              <span className="text-dark-300">Danger</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-orange-500 rounded-full" />
              <span className="text-dark-300">Caution</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-yellow-500 rounded-full" />
              <span className="text-dark-300">Awareness</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-blue-500 rounded-full" />
              <span className="text-dark-300">Info</span>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-white/10">
              <span className="w-3 h-3 bg-primary-500 rounded-full" />
              <span className="text-dark-300">You</span>
            </div>
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}