"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { PostCard } from "@/components/posts/PostCard";
import { Button } from "@/components/ui/Button";
import { Post } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { TrendingUp, MapPin, Loader2, Search, RefreshCw } from "lucide-react";

type FeedTab = "nearby" | "trending";

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FeedTab>("nearby");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchPosts();
  }, [activeTab]);

  const fetchPosts = useCallback(async () => {
    setLoading(true);

    try {
      let query = supabase
        .from("posts")
        .select(`
          *,
          post_media (*),
          post_tags (tag)
        `)
        .eq("status", "live");

      // Different ordering based on tab
      if (activeTab === "trending") {
        query = query
          .order("confirmations", { ascending: false })
          .order("views", { ascending: false });
      } else {
        query = query.order("created_at", { ascending: false });
      }

      const { data: postsData, error: postsError } = await query.limit(30);

      if (postsError) {
        console.error("Error fetching posts:", postsError);
        setLoading(false);
        return;
      }

      if (!postsData || postsData.length === 0) {
        setPosts([]);
        setLoading(false);
        return;
      }

      const formattedPosts: Post[] = postsData.map((post) => ({
        id: post.id,
        user_id: post.user_id,
        category: post.category,
        comment: post.comment,
        location: {
          latitude: 0,
          longitude: 0,
        },
        address: post.address,
        is_anonymous: post.is_anonymous,
        status: post.status,
        is_sensitive: post.is_sensitive,
        confirmations: post.confirmations || 0,
        views: post.views || 0,
        created_at: post.created_at,
        media:
          post.post_media?.map((m: any) => ({
            id: m.id,
            post_id: m.post_id,
            url: m.url,
            media_type: m.media_type as "photo" | "video",
            is_sensitive: m.is_sensitive,
            thumbnail_url: m.thumbnail_url,
          })) || [],
        tags: post.post_tags?.map((t: any) => t.tag) || [],
      }));

      setPosts(formattedPosts);
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchPosts();
  };

  const handleSharePost = async (post: Post) => {
    const shareUrl = `${window.location.origin}/post/${post.id}`;
    const shareText = post.comment || "Check out this incident on Peja";

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Peja Alert",
          text: shareText,
          url: shareUrl,
        });
      } catch (error) {
        console.log("Share cancelled");
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        alert("Link copied to clipboard!");
      } catch (error) {
        console.error("Failed to copy:", error);
      }
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
        {/* Profile Completion Banner */}
        {user && !user.occupation && (
          <div className="max-w-2xl mx-auto px-4 pt-4">
            <div className="glass-card p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-dark-200">Complete your profile</p>
                <p className="text-xs text-dark-400">Add your details to help your community</p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => router.push("/profile/edit")}
              >
                Complete
              </Button>
            </div>
          </div>
        )}

        <div className="max-w-2xl mx-auto px-4 py-4">
          {/* Search Bar */}
          <button
            onClick={() => router.push("/search")}
            className="w-full flex items-center gap-3 px-4 py-3 glass-sm rounded-xl mb-4 text-dark-400 hover:bg-white/5 transition-colors"
          >
            <Search className="w-5 h-5" />
            <span>Search incidents, #tags, locations...</span>
          </button>

          {/* Feed Tabs */}
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant={activeTab === "nearby" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("nearby")}
              leftIcon={<MapPin className="w-4 h-4" />}
            >
              Nearby
            </Button>
            <Button
              variant={activeTab === "trending" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("trending")}
              leftIcon={<TrendingUp className="w-4 h-4" />}
            >
              Trending
            </Button>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="ml-auto p-2 glass-sm rounded-lg hover:bg-white/10"
            >
              <RefreshCw
                className={`w-4 h-4 text-dark-400 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          {/* Tab Description */}
          <p className="text-sm text-dark-500 mb-4">
            {activeTab === "nearby" && "Latest incidents in your area"}
            {activeTab === "trending" && "Most confirmed and viewed incidents"}
          </p>

          {/* Posts */}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12">
              <MapPin className="w-12 h-12 text-dark-600 mx-auto mb-4" />
              <p className="text-dark-400 mb-2">No incidents reported yet</p>
              <p className="text-sm text-dark-500 mb-4">
                Be the first to report what's happening in your area
              </p>
              <Button variant="primary" onClick={() => router.push("/create")}>
                Report Incident
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onConfirm={() => {}}
                  onShare={handleSharePost}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}