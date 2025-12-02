"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { PostCard } from "@/components/posts/PostCard";
import { Button } from "@/components/ui/Button";
import { Post } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { TrendingUp, MapPin, Users, Loader2 } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"nearby" | "following" | "trending">("nearby");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = async () => {
    setLoading(true);

    try {
      // Single optimized query with joins
      const { data: postsData, error: postsError } = await supabase
        .from("posts")
        .select(`
          *,
          post_media (*),
          post_tags (tag)
        `)
        .eq("status", "live")
        .order("created_at", { ascending: false })
        .limit(20);

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
        media: post.post_media?.map((m: any) => ({
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
    }
  };

  const handleConfirmPost = async (postId: string) => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();

      if (!authUser) {
        router.push("/login");
        return;
      }

      // Check if already confirmed
      const { data: existing } = await supabase
        .from("post_confirmations")
        .select("id")
        .eq("post_id", postId)
        .eq("user_id", authUser.id)
        .maybeSingle();

      const currentPost = posts.find(p => p.id === postId);
      const currentConfirmations = currentPost?.confirmations || 0;

      if (existing) {
        // Remove confirmation
        await supabase
          .from("post_confirmations")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", authUser.id);

        await supabase
          .from("posts")
          .update({ confirmations: Math.max(0, currentConfirmations - 1) })
          .eq("id", postId);

        // Update local state immediately
        setPosts(posts.map(p => 
          p.id === postId 
            ? { ...p, confirmations: Math.max(0, currentConfirmations - 1) }
            : p
        ));
      } else {
        // Add confirmation
        await supabase
          .from("post_confirmations")
          .insert({ post_id: postId, user_id: authUser.id });

        await supabase
          .from("posts")
          .update({ confirmations: currentConfirmations + 1 })
          .eq("id", postId);

        // Update local state immediately
        setPosts(posts.map(p => 
          p.id === postId 
            ? { ...p, confirmations: currentConfirmations + 1 }
            : p
        ));
      }
    } catch (error) {
      console.error("Error confirming post:", error);
    }
  };

  const handleSharePost = async (post: Post) => {
    const shareUrl = `https://peja.vercel.app/post/${post.id}`;
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

        <div className="max-w-2xl mx-auto px-4 py-6">
          <div className="flex gap-2 mb-6 overflow-x-auto scrollbar-hide">
            <Button
              variant={activeTab === "nearby" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("nearby")}
              leftIcon={<MapPin className="w-4 h-4" />}
            >
              Nearby
            </Button>
            <Button
              variant={activeTab === "following" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("following")}
              leftIcon={<Users className="w-4 h-4" />}
            >
              Following
            </Button>
            <Button
              variant={activeTab === "trending" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setActiveTab("trending")}
              leftIcon={<TrendingUp className="w-4 h-4" />}
            >
              Trending
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-dark-400 mb-4">No incidents reported yet</p>
              <Button
                variant="primary"
                onClick={() => router.push("/create")}
              >
                Report First Incident
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onConfirm={handleConfirmPost}
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