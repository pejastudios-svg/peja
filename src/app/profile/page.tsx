"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFeedCache } from "@/context/FeedContext";
import { useConfirm } from "@/context/ConfirmContext";
import { PostCardSkeleton } from "@/components/posts/PostCardSkeleton";
import {
  User,
  Mail,
  Phone,
  Briefcase,
  Shield,
  Settings,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Edit,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { Post } from "@/lib/types";
import { PostCard } from "@/components/posts/PostCard";

export default function ProfilePage() {
  const confirm = useConfirm();
  const feedCache = useFeedCache();
  const router = useRouter();
  const { user, signOut } = useAuth();

  // --- SCROLL RESTORATION REFS ---
  const scrollYRef = useRef(0);
  const lastStableScrollRef = useRef(0);
  const hasRestoredScroll = useRef(false);
  const isTrackingScroll = useRef(false);
  const stabilityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const feedCacheRef = useRef(feedCache);
  feedCacheRef.current = feedCache;

  const [userPosts, setUserPosts] = useState<Post[]>(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get("profile:posts");
      if (cached?.posts?.length) return cached.posts;
    }
    return [];
  });

  const [confirmedPosts, setConfirmedPosts] = useState<Post[]>(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get("profile:confirmed");
      if (cached?.posts?.length) return cached.posts;
    }
    return [];
  });

  const [postsLoading, setPostsLoading] = useState(() => userPosts.length === 0);
  const [confirmedLoading, setConfirmedLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"posts" | "confirmed">("posts");

  useLayoutEffect(() => {
    if (typeof window !== "undefined") {
      history.scrollRestoration = "manual";
    }
  }, []);

  useLayoutEffect(() => {
    if (hasRestoredScroll.current) return;
    if (userPosts.length === 0 && postsLoading) return;

    const savedY = feedCacheRef.current.get("profile")?.scrollY ?? 0;
    
    if (savedY === 0) {
      hasRestoredScroll.current = true;
      isTrackingScroll.current = true;
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, savedY);
        scrollYRef.current = savedY;
        lastStableScrollRef.current = savedY;
        hasRestoredScroll.current = true;
        
        setTimeout(() => {
          isTrackingScroll.current = true;
        }, 100);
      });
    });
  }, [userPosts.length, postsLoading]);

  useEffect(() => {
    const onScroll = () => {
      if (!isTrackingScroll.current) return;
      
      const currentY = window.scrollY;
      scrollYRef.current = currentY;
      
      if (stabilityTimeoutRef.current) {
        clearTimeout(stabilityTimeoutRef.current);
      }
      stabilityTimeoutRef.current = setTimeout(() => {
        lastStableScrollRef.current = currentY;
        feedCacheRef.current.setScroll("profile", currentY);
      }, 100);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (stabilityTimeoutRef.current) {
        clearTimeout(stabilityTimeoutRef.current);
      }
      if (isTrackingScroll.current && lastStableScrollRef.current >= 0) {
        feedCacheRef.current.setScroll("profile", lastStableScrollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    router.prefetch("/map");
    router.prefetch("/notifications");
    router.prefetch("/settings");
    router.prefetch("/watch");
  }, [router]);

  useEffect(() => {
    if (user) {
      fetchUserPosts();
    }
  }, [user]);

  const fetchUserPosts = async () => {
    if (!user) return;
    if (userPosts.length === 0) setPostsLoading(true);

    try {
      const { data: postsData, error } = await supabase
        .from("posts")
        .select(`*, post_media (*), post_tags (tag)`)
        .eq("user_id", user.id)
        .in("status", ["live", "resolved"])
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching user posts:", error);
        if (userPosts.length === 0) setUserPosts([]);
        return;
      }

      const formattedPosts: Post[] = (postsData || []).map((post: any) => ({
        id: post.id,
        user_id: post.user_id,
        category: post.category,
        comment: post.comment,
        location: { latitude: post.latitude ?? 0, longitude: post.longitude ?? 0 },
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
          post_id: m.post_id,
          url: m.url,
          media_type: m.media_type as "photo" | "video",
          is_sensitive: m.is_sensitive,
          thumbnail_url: m.thumbnail_url,
        })) || [],
        tags: post.post_tags?.map((t: any) => t.tag) || [],
      }));

      setUserPosts(formattedPosts);
      feedCache.setPosts("profile:posts", formattedPosts);
      confirm.hydrateCounts(formattedPosts.map(p => ({ postId: p.id, confirmations: p.confirmations || 0 })));
      confirm.loadConfirmedFor(formattedPosts.map(p => p.id));
    } catch (e) {
      console.error("Error:", e);
    } finally {
      setPostsLoading(false);
    }
  };

  const fetchConfirmedPosts = async () => {
    if (!user) return;
    if (confirmedPosts.length === 0) setConfirmedLoading(true);

    try {
      const { data, error } = await supabase
        .from("post_confirmations")
        .select(`post_id, posts:post_id (*, post_media (*), post_tags (tag))`)
        .eq("user_id", user.id);

      if (error) return;

      const rawPosts = (data || []).map((row: any) => row.posts).filter(Boolean);
      const unique = new Map<string, any>();
      rawPosts.forEach((p: any) => unique.set(p.id, p));

      const formatted: Post[] = Array.from(unique.values())
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((post: any) => ({
          id: post.id,
          user_id: post.user_id,
          category: post.category,
          comment: post.comment,
          location: { latitude: post.latitude ?? 0, longitude: post.longitude ?? 0 },
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
            post_id: m.post_id,
            url: m.url,
            media_type: m.media_type,
            is_sensitive: m.is_sensitive,
            thumbnail_url: m.thumbnail_url,
          })) || [],
          tags: post.post_tags?.map((t: any) => t.tag) || [],
        }));

      const filtered = formatted.filter(p => p.status !== "archived");
      setConfirmedPosts(filtered);
      feedCache.setPosts("profile:confirmed", filtered);
      confirm.hydrateCounts(filtered.map(p => ({ postId: p.id, confirmations: p.confirmations || 0 })));
      confirm.loadConfirmedFor(filtered.map(p => p.id));
    } catch (e) {
      console.error(e);
    } finally {
      setConfirmedLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  if (!user) {
    return (
      <div className="min-h-screen pb-20 pt-14">
        <div className="fixed top-0 left-0 right-0 z-40 glass border-b border-white/5 h-14" />
        <div className="glass border-b border-white/5 px-4 py-6">
          <div className="max-w-2xl mx-auto flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-white/5 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-32 bg-white/5 rounded animate-pulse" />
              <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
            </div>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <PostCardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  const showingConfirmed = activeTab === "confirmed";
  const list = showingConfirmed ? confirmedPosts : userPosts;
  const listLoading = showingConfirmed ? confirmedLoading : postsLoading;

  return (
    <div className="min-h-screen pb-20">
      <header className="fixed top-0 left-0 right-0 z-40 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors">
            <ChevronLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="font-semibold text-dark-50">Profile</h1>
          <button onClick={() => router.push("/settings")} className="p-2 -mr-2 hover:bg-white/5 rounded-lg transition-colors">
            <Settings className="w-5 h-5 text-dark-200" />
          </button>
        </div>
      </header>

      <main className="pt-14">
        <div className="glass border-b border-white/5 px-4 py-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-primary-600/20 border-2 border-primary-500/50 flex items-center justify-center overflow-hidden">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt={user.full_name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-10 h-10 text-primary-400" />
                  )}
                </div>
                <button onClick={() => router.push("/profile/edit")} className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center border-2 border-dark-950">
                  <Camera className="w-4 h-4 text-white" />
                </button>
              </div>

              <div className="flex-1">
                <h2 className="text-lg font-semibold text-dark-50">{user.full_name || "User"}</h2>
                <p className="text-sm text-dark-400">{user.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-dark-500">{userPosts.length} posts</span>
                  <span className="text-dark-600">•</span>
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Verified
                  </span>
                </div>
              </div>

              <Button variant="secondary" size="sm" onClick={() => router.push("/profile/edit")}>
                <Edit className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="glass-card mb-4">
            <h3 className="text-sm font-medium text-dark-300 mb-3">Information</h3>
            <div className="space-y-3">
              {user.email && <div className="flex items-center gap-3"><Mail className="w-4 h-4 text-dark-500" /><span className="text-sm text-dark-200">{user.email}</span></div>}
              {user.phone && <div className="flex items-center gap-3"><Phone className="w-4 h-4 text-dark-500" /><span className="text-sm text-dark-200">{user.phone}</span></div>}
              {user.occupation && <div className="flex items-center gap-3"><Briefcase className="w-4 h-4 text-dark-500" /><span className="text-sm text-dark-200">{user.occupation}</span></div>}
            </div>
          </div>

          <div className="glass-card mb-4">
            <h3 className="text-sm font-medium text-dark-300 mb-3">Quick Actions</h3>
            <div className="space-y-1">
              <button onClick={() => router.push("/settings")} className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3"><Settings className="w-5 h-5 text-dark-400" /><span className="text-sm text-dark-200">Settings</span></div>
                <ChevronRight className="w-4 h-4 text-dark-500" />
              </button>
              <button onClick={() => router.push("/become-guardian")} className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3"><Shield className="w-5 h-5 text-dark-400" /><span className="text-sm text-dark-200">Become a Guardian</span></div>
                <ChevronRight className="w-4 h-4 text-dark-500" />
              </button>
              <button onClick={handleSignOut} className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3"><LogOut className="w-5 h-5 text-red-400" /><span className="text-sm text-red-400">Sign Out</span></div>
              </button>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex gap-2 mb-4">
              <Button variant={activeTab === "posts" ? "primary" : "secondary"} size="sm" onClick={() => setActiveTab("posts")}>My Posts</Button>
              <Button variant={activeTab === "confirmed" ? "primary" : "secondary"} size="sm" onClick={() => { setActiveTab("confirmed"); if (confirmedPosts.length === 0) fetchConfirmedPosts(); }}>Confirmed</Button>
            </div>

            {listLoading && list.length === 0 ? (
              <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <PostCardSkeleton key={i} />)}</div>
            ) : list.length === 0 ? (
              <div className="text-center py-8 text-dark-400">No posts yet.</div>
            ) : (
              <div className="space-y-4">
                {list.map((post) => (
                  <PostCard key={post.id} post={post} onConfirm={() => {}} onShare={() => {}} sourceKey={showingConfirmed ? "profile:confirmed" : "profile:posts"} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}