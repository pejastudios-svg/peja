"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
  Layers,
  X,
  ChevronUp,
  Clock,
  Eye,
  CheckCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// Note: You'll need to add a map library. For now, we'll create a simple list view
// that can be upgraded to a proper map later (Google Maps, Mapbox, or Leaflet)

export default function MapPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  useEffect(() => {
    getUserLocation();
    fetchPosts();
  }, []);

  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.error("Error getting location:", error);
        }
      );
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

  const filteredPosts = filterCategory
    ? posts.filter((p) => p.category === filterCategory)
    : posts;

  const getCategoryColor = (categoryId: string) => {
    const category = CATEGORIES.find((c) => c.id === categoryId);
    if (!category) return "bg-blue-500";
    switch (category.color) {
      case "danger":
        return "bg-red-500";
      case "warning":
        return "bg-orange-500";
      case "awareness":
        return "bg-yellow-500";
      default:
        return "bg-blue-500";
    }
  };

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header
        onMenuClick={() => setSidebarOpen(true)}
        onCreateClick={() => router.push("/create")}
      />

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="pt-16 lg:pl-64">
        {/* Map Container - Placeholder for now */}
        <div className="relative h-[calc(100vh-8rem)] lg:h-[calc(100vh-4rem)] bg-dark-800">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            </div>
          ) : (
            <>
              {/* Map Placeholder - Replace with actual map component */}
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-dark-900 to-dark-800">
                <div className="text-center">
                  <MapPin className="w-16 h-16 text-primary-500 mx-auto mb-4" />
                  <h2 className="text-xl font-semibold text-dark-100 mb-2">Map View</h2>
                  <p className="text-dark-400 max-w-md mx-auto px-4">
                    {filteredPosts.length} incidents in your area. 
                    Tap on any incident below to view details.
                  </p>
                  {userLocation && (
                    <p className="text-sm text-dark-500 mt-2">
                      Your location: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
                    </p>
                  )}
                </div>

                {/* Simulated markers */}
                <div className="absolute inset-0 pointer-events-none">
                  {filteredPosts.slice(0, 20).map((post, index) => (
                    <div
                      key={post.id}
                      className="absolute pointer-events-auto cursor-pointer"
                      style={{
                        left: `${15 + (index * 7) % 70}%`,
                        top: `${20 + (index * 11) % 60}%`,
                      }}
                      onClick={() => setSelectedPost(post)}
                    >
                      <div
                        className={`w-8 h-8 rounded-full ${getCategoryColor(
                          post.category
                        )} flex items-center justify-center shadow-lg animate-pulse`}
                      >
                        <MapPin className="w-4 h-4 text-white" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Category Filter Pills */}
              <div className="absolute top-4 left-4 right-4 z-10">
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  <button
                    onClick={() => setFilterCategory(null)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                      !filterCategory
                        ? "bg-primary-600 text-white"
                        : "glass-sm text-dark-200"
                    }`}
                  >
                    All ({posts.length})
                  </button>
                  {["danger", "warning", "awareness", "info"].map((color) => {
                    const categoryGroup = CATEGORIES.filter((c) => c.color === color);
                    const count = posts.filter((p) =>
                      categoryGroup.some((c) => c.id === p.category)
                    ).length;

                    if (count === 0) return null;

                    const colorClass =
                      color === "danger"
                        ? "bg-red-500/20 text-red-400 border-red-500/50"
                        : color === "warning"
                        ? "bg-orange-500/20 text-orange-400 border-orange-500/50"
                        : color === "awareness"
                        ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/50"
                        : "bg-blue-500/20 text-blue-400 border-blue-500/50";

                    return (
                      <button
                        key={color}
                        onClick={() =>
                          setFilterCategory(
                            filterCategory === categoryGroup[0]?.id
                              ? null
                              : categoryGroup[0]?.id
                          )
                        }
                        className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap border ${colorClass}`}
                      >
                        {color.charAt(0).toUpperCase() + color.slice(1)} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* My Location Button */}
              <button
                onClick={getUserLocation}
                className="absolute bottom-4 right-4 z-10 p-3 glass rounded-full"
              >
                <Navigation className="w-5 h-5 text-primary-400" />
              </button>

              {/* Incidents List (Bottom Sheet Style) */}
              <div className="absolute bottom-0 left-0 right-0 z-10 max-h-[40%] overflow-y-auto glass rounded-t-2xl">
                <div className="sticky top-0 glass py-2 px-4 border-b border-white/5">
                  <div className="w-10 h-1 bg-dark-600 rounded-full mx-auto mb-2" />
                  <p className="text-sm text-dark-400 text-center">
                    {filteredPosts.length} incidents nearby
                  </p>
                </div>

                <div className="p-4 space-y-3">
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
                            className="w-16 h-16 rounded-lg object-cover"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={badgeVariant}>
                              {category?.name || post.category}
                            </Badge>
                            <span className="text-xs text-dark-500">
                              {formatDistanceToNow(new Date(post.created_at), {
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                          {post.comment && (
                            <p className="text-sm text-dark-200 line-clamp-1">
                              {post.comment}
                            </p>
                          )}
                          {post.address && (
                            <p className="text-xs text-dark-400 flex items-center gap-1 mt-1">
                              <MapPin className="w-3 h-3" />
                              {post.address}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      <BottomNav />

      {/* Selected Post Modal */}
      {selectedPost && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-50"
            onClick={() => setSelectedPost(null)}
          />
          <div className="fixed bottom-20 left-4 right-4 z-50 glass-card">
            <button
              onClick={() => setSelectedPost(null)}
              className="absolute top-2 right-2 p-1 hover:bg-white/10 rounded"
            >
              <X className="w-5 h-5 text-dark-400" />
            </button>

            <div className="flex gap-3">
              {selectedPost.media?.[0] && (
                <img
                  src={selectedPost.media[0].url}
                  alt=""
                  className="w-20 h-20 rounded-lg object-cover"
                />
              )}
              <div className="flex-1">
                <Badge
                  variant={
                    CATEGORIES.find((c) => c.id === selectedPost.category)?.color === "danger"
                      ? "danger"
                      : "warning"
                  }
                >
                  {CATEGORIES.find((c) => c.id === selectedPost.category)?.name}
                </Badge>
                {selectedPost.comment && (
                  <p className="text-sm text-dark-200 mt-2 line-clamp-2">
                    {selectedPost.comment}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-2 text-xs text-dark-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(selectedPost.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    {selectedPost.confirmations}
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    {selectedPost.views}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => router.push(`/post/${selectedPost.id}`)}
              className="w-full mt-4 py-2 bg-primary-600 text-white rounded-lg font-medium"
            >
              View Details
            </button>
          </div>
        </>
      )}
    </div>
  );
}