"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { PostCard } from "@/components/posts/PostCard";
import { Button } from "@/components/ui/Button";
import { Post } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { realtimeManager } from "@/lib/realtime";
import { TrendingUp, MapPin, Loader2, Search, RefreshCw } from "lucide-react";

type FeedTab = "nearby" | "trending";

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<FeedTab>("nearby");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const formatPost = useCallback(async (postData: any): Promise<Post | null> => {
    try {
      // Fetch media and tags for new post
      const [{ data: media }, { data: tags }] = await Promise.all([
        supabase.from("post_media").select("*").eq("post_id", postData.id),
        supabase.from("post_tags").select("tag").eq("post_id", postData.id),
      ]);

      return {
        id: postData.id,
        user_id: postData.user_id,
        category: postData.category,
        comment: postData.comment,
        location: { latitude: 0, longitude: 0 },
        address: postData.address,
        is_anonymous: postData.is_anonymous,
        status: postData.status,
        is_sensitive: postData.is_sensitive,
        confirmations: postData.confirmations || 0,
        views: postData.views || 0,
        comment_count: postData.comment_count || 0,
        report_count: postData.report_count || 0,
        created_at: postData.created_at,
        media: media?.map((m: any) => ({
          id: m.id,
          post_id: postData.id,
          url: m.url,
          media_type: m.media_type,
          is_sensitive: m.is_sensitive,
        })) || [],
        tags: tags?.map((t: any) => t.tag) || [],
      };
    } catch {
      return null;
    }
  }, []);

  const fetchPosts = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      let query = supabase
        .from("posts")
        .select(`
          id, user_id, category, comment, address, is_anonymous,
          status, is_sensitive, confirmations, views, comment_count, report_count, created_at,
          post_media (id, url, media_type, is_sensitive),
          post_tags (tag)
        `)
        .eq("status", "live")
        .gte("created_at", twentyFourHoursAgo);

      if (activeTab === "trending") {
        query = query.order("confirmations", { ascending: false }).order("views", { ascending: false });
      } else {
        query = query.order("created_at", { ascending: false });
      }

      const { data, error } = await query.limit(30);

      if (error) {
        console.error("Fetch error:", error);
        setPosts([]);
        return;
      }

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
        comment_count: post.comment_count || 0,
        report_count: post.report_count || 0,
        created_at: post.created_at,
        media: post.post_media?.map((m: any) => ({
          id: m.id,
          post_id: post.id,
          url: m.url,
          media_type: m.media_type,
          is_sensitive: m.is_sensitive,
        })) || [],
        tags: post.post_tags?.map((t: any) => t.tag) || [],
      }));

      setPosts(formattedPosts);
    } catch (err) {
      console.error("Fetch error:", err);
      setPosts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab]);

  // Initial fetch
  useEffect(() => {
    if (!authLoading) {
      fetchPosts();
    }
  }, [activeTab, authLoading, fetchPosts]);

  // Real-time subscription
  useEffect(() => {
    const unsubscribe = realtimeManager.subscribeToPosts(
      // On new post
      async (newPost) => {
        if (newPost.status === "live") {
          const formatted = await formatPost(newPost);
          if (formatted) {
            setPosts(prev => [formatted, ...prev]);
          }
        }
      },
      // On post update
      (updatedPost) => {
        setPosts(prev => prev.map(p => {
          if (p.id === updatedPost.id) {
            return {
              ...p,
              confirmations: updatedPost.confirmations || p.confirmations,
              views: updatedPost.views || p.views,
              comment_count: updatedPost.comment_count || p.comment_count,
              status: updatedPost.status,
            };
          }
          return p;
        }).filter(p => p.status === "live"));
      },
      // On post delete
      (deletedPost) => {
        setPosts(prev => prev.filter(p => p.id !== deletedPost.id));
      }
    );

    return () => unsubscribe();
  }, [formatPost]);

  useEffect(() => {
  router.prefetch("/map");
  router.prefetch("/notifications");
  router.prefetch("/profile");
}, [router]);

  const handleRefresh = () => {
    fetchPosts(true);
  };

  const handleSharePost = async (post: Post) => {
    const shareUrl = `${window.location.origin}/post/${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Peja Alert", url: shareUrl });
      } catch {}
    } else {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link copied!");
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
    <Header onCreateClick={() => router.push("/create")} />

      <main className="pt-16 lg:pl-64">
        {user && !user.occupation && (
          <div className="max-w-2xl mx-auto px-4 pt-4">
            <div className="glass-card p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-dark-200">Complete your profile</p>
                <p className="text-xs text-dark-400">Add your details to help your community</p>
              </div>
              <Button variant="primary" size="sm" onClick={() => router.push("/profile/edit")}>
                Complete
              </Button>
            </div>
          </div>
        )}

        <div className="max-w-2xl mx-auto px-4 py-4">
          <button
            onClick={() => router.push("/search")}
            className="w-full flex items-center gap-3 px-4 py-3 glass-sm rounded-xl mb-4 text-dark-400 hover:bg-white/5 transition-colors"
          >
            <Search className="w-5 h-5" />
            <span>Search incidents, #tags, locations...</span>
          </button>

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
              <RefreshCw className={`w-4 h-4 text-dark-400 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12">
              <MapPin className="w-12 h-12 text-dark-600 mx-auto mb-4" />
              <p className="text-dark-400 mb-2">No recent incidents</p>
              <p className="text-sm text-dark-500 mb-4">Be the first to report</p>
              <Button variant="primary" onClick={() => router.push("/create")}>
                Report Incident
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {refreshing && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                </div>
              )}
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