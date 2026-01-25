"use client";

import { useState, useEffect, useCallback, useLayoutEffect } from "react";
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
import { useFeedCache } from "@/context/FeedContext";
import { useConfirm } from "@/context/ConfirmContext";
import { PostCardSkeleton } from "@/components/posts/PostCardSkeleton";

type FeedTab = "nearby" | "trending";

const HOME_UI_KEY = "peja-home-ui-v1";

function loadHomeUI(): {
  activeTab?: FeedTab;
  trendingMode?: "recommended" | "top";
  showSeenTop?: boolean;
} {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(HOME_UI_KEY) || "{}");
  } catch {
    return {};
  }
}

export default function Home() {
  const confirm = useConfirm();
  const router = useRouter();
  // FIXED: Removed 'loading: authLoading'. We do NOT wait for auth to render the feed.
  const { user, session } = useAuth();
  const feedCache = useFeedCache();

  const initialUI = loadHomeUI();
  const [activeTab, setActiveTab] = useState<FeedTab>(initialUI.activeTab ?? "nearby");
  type TrendingMode = "recommended" | "top";
  const [trendingMode, setTrendingMode] = useState<TrendingMode>(initialUI.trendingMode ?? "recommended");
  const [showSeenTop, setShowSeenTop] = useState<boolean>(initialUI.showSeenTop ?? false);
  const [showSeenNearby, setShowSeenNearby] = useState(false);

  const feedKey = activeTab === "trending"
    ? `home:trending:${trendingMode}:${showSeenTop ? "seen" : "unseen"}`
    : `home:nearby:${showSeenNearby ? "seen" : "unseen"}`;

  // --- INSTANT STATE ---
  const [posts, setPosts] = useState<Post[]>(() => {
     if (typeof window !== 'undefined') {
        const cached = feedCache.get(feedKey);
        if (cached?.posts?.length) return cached.posts;
     }
     return [];
  });

  const [loading, setLoading] = useState(() => {
     if (typeof window !== 'undefined') {
        const cached = feedCache.get(feedKey);
        if (cached?.posts?.length) return false;
     }
     return true;
  });

  const [refreshing, setRefreshing] = useState(false);

  // --- CRITICAL FIX: useLayoutEffect ---
  // This runs BEFORE the browser paints. It forces the scroll position instantly.
  useLayoutEffect(() => {
    const cached = feedCache.get(feedKey);
    // Only restore if we have data and a valid scroll position
    if (cached && cached.scrollY > 0 && posts.length > 0) {
       window.scrollTo(0, cached.scrollY);
    }
  }, [feedKey, posts.length]); 

  // --- Save Scroll ---
  useEffect(() => {
    const save = () => {
        // Don't save '0' if the page hasn't fully loaded yet
        if (window.scrollY > 0) feedCache.setScroll(feedKey, window.scrollY);
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [feedKey, feedCache]);

  // Save UI Preferences
  useEffect(() => {
    try {
      sessionStorage.setItem(
        HOME_UI_KEY,
        JSON.stringify({ activeTab, trendingMode, showSeenTop, showSeenNearby })
      );
    } catch {}
  }, [activeTab, trendingMode, showSeenTop, showSeenNearby]);

  const formatPost = useCallback(async (postData: any): Promise<Post | null> => {
    try {
      const [{ data: media }, { data: tags }] = await Promise.all([
        supabase.from("post_media").select("*").eq("post_id", postData.id),
        supabase.from("post_tags").select("tag").eq("post_id", postData.id),
      ]);

      return {
        id: postData.id,
        user_id: postData.user_id,
        category: postData.category,
        comment: postData.comment,
        location: {
          latitude: postData.latitude ?? 0,
          longitude: postData.longitude ?? 0,
        },
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

  function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  } 

  const SEEN_KEY = "peja-seen-posts-v1";
  const SEEN_GRACE_MS = 30 * 60 * 1000;

  type SeenStore = Record<string, number>;

  function readSeenStore(): SeenStore {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const m: SeenStore = {};
        for (const id of parsed) if (typeof id === "string") m[id] = 0;
        return m;
      }
      if (parsed && typeof parsed === "object") return parsed as SeenStore;
      return {};
    } catch { return {}; }
  }

  function isHideableSeen(store: SeenStore, postId: string) {
    const t = store[postId];
    if (typeof t !== "number") return false;
    return Date.now() - t >= SEEN_GRACE_MS;
  }

  function recommendedScore(p: Post) {
    const ageHours = (Date.now() - new Date(p.created_at).getTime()) / 36e5;
    const e = (p.confirmations || 0) * 10 + (p.comment_count || 0) * 4 + Math.min(p.views || 0, 5000) * 0.2;
    return e / Math.pow(ageHours + 2, 1.4);
  }

  const applyCachedFeed = useCallback((key: string) => {
    const cached = feedCache.get(key);
    if (cached?.posts?.length) {
      setPosts(cached.posts);
      setLoading(false);
    } else {
      setPosts([]);
      setLoading(true);
    }
  }, [feedCache]);

  const fetchPosts = useCallback(async (isRefresh = false) => {
    const cached = feedCache.get(feedKey);
    const usedCache = !isRefresh && cached && cached.posts.length > 0;

    if (usedCache) {
      setPosts(cached.posts);
      setLoading(false);
    }

    if (isRefresh) setRefreshing(true);
    else if (!usedCache) setLoading(true);

    try {
      const baseSelect = `
        id, user_id, category, comment, address,
        latitude, longitude,
        is_anonymous, status, is_sensitive, confirmations, views, comment_count, report_count, created_at,
        post_media (id, url, media_type, is_sensitive),
        post_tags (tag)
      `;

      let data: any[] | null = null;
      let error: any = null;

      if (activeTab === "trending") {
        if (trendingMode === "recommended") {
          const newestQ = supabase.from("posts").select(baseSelect).in("status", ["live", "resolved"]).order("created_at", { ascending: false }).limit(120);
          const hotQ = supabase.from("posts").select(baseSelect).in("status", ["live", "resolved"]).order("confirmations", { ascending: false }).limit(120);
          const [newestRes, hotRes] = await Promise.all([newestQ, hotQ]);
          
          const map = new Map<string, any>();
          (newestRes.data || []).forEach((p: any) => map.set(p.id, p));
          (hotRes.data || []).forEach((p: any) => map.set(p.id, p));
          data = Array.from(map.values());
        } else {
          const res = await supabase.from("posts").select(baseSelect).in("status", ["live", "resolved"]).order("confirmations", { ascending: false }).limit(200);
          data = res.data;
        }
      } else {
        const res = await supabase.from("posts").select(baseSelect).in("status", ["live", "resolved"]).order("created_at", { ascending: false }).limit(200);
        data = res.data;
      }

      if (error) throw error;

      const formattedPosts: Post[] = (data || []).map((post) => ({
        id: post.id,
        user_id: post.user_id,
        category: post.category,
        comment: post.comment,
        location: { latitude: (post as any).latitude ?? 0, longitude: (post as any).longitude ?? 0 },
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

      const seenStore = readSeenStore();
      let finalPosts = formattedPosts;

      if (activeTab === "nearby") {
        const baseList = showSeenNearby ? formattedPosts : formattedPosts.filter(p => !isHideableSeen(seenStore, p.id));
        const userLat = user?.last_latitude ?? null;
        const userLng = user?.last_longitude ?? null;

        if (userLat != null && userLng != null) {
          finalPosts = [...baseList].sort((a, b) => {
            const da = distanceKm(userLat, userLng, a.location?.latitude || 0, a.location?.longitude || 0);
            const db = distanceKm(userLat, userLng, b.location?.latitude || 0, b.location?.longitude || 0);
            if (da !== db) return da - db;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
          finalPosts = finalPosts.slice(0, 30);
        } else {
          finalPosts = [...baseList].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 30);
        }
      } else {
        if (trendingMode === "recommended") {
          finalPosts = formattedPosts.filter(p => !isHideableSeen(seenStore, p.id)).sort((a, b) => recommendedScore(b) - recommendedScore(a)).slice(0, 30);
        } else {
          finalPosts = (showSeenTop ? formattedPosts : formattedPosts.filter(p => !isHideableSeen(seenStore, p.id))).sort((a, b) => recommendedScore(b) - recommendedScore(a)).slice(0, 30);
        }
      }

      confirm.hydrateCounts(finalPosts.map(p => ({ postId: p.id, confirmations: p.confirmations || 0 })));
      confirm.loadConfirmedFor(finalPosts.map(p => p.id));

      setPosts(finalPosts);
      feedCache.setPosts(feedKey, finalPosts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab, feedKey, feedCache, trendingMode, showSeenTop, user]);

  useEffect(() => {
    fetchPosts();
  }, [activeTab, fetchPosts]);

  useEffect(() => {
    if (!session?.access_token) return;
    fetch("/api/jobs/expire", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => {});
  }, [session?.access_token]);

  // Real-time logic (Same as before)
  useEffect(() => {
    const unsubscribe = realtimeManager.subscribeToPosts(
      async (newPost) => {
        if (newPost.status === "live") {
          const formatted = await formatPost(newPost);
          if (formatted) {
            setPosts((prev) => {
              const next = [formatted, ...prev].slice(0, 30); 
              feedCache.setPosts(feedKey, next);
              return next;
            });
          }
        }
      },
      (updatedPost) => {
        setPosts((prev) => {
          const next = prev.map(p => p.id === updatedPost.id ? { ...p, ...updatedPost } : p).filter(p => p.status === "live" || p.status === "resolved");
          feedCache.setPosts(feedKey, next);
          return next;
        });
      },
      (deletedPost) => {
        setPosts((prev) => {
          const next = prev.filter(p => p.id !== deletedPost.id);
          feedCache.setPosts(feedKey, next);
          return next;
        });
      }
    );
    return () => unsubscribe();
  }, [formatPost, feedKey, feedCache]);

  const handleSharePost = async (post: Post) => {
    const shareUrl = `${window.location.origin}/post/${post.id}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Peja Alert", url: shareUrl }); } catch {}
    } else {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link copied!");
    }
  };

  // REMOVED THE AUTH LOADING BLOCKER HERE.
  // The UI will render immediately. If user is null, distance sort falls back to chronological.

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
              <Button variant="primary" size="sm" onClick={() => router.push("/profile/edit")}>Complete</Button>
            </div>
          </div>
        )}

        <div className="max-w-2xl mx-auto px-4 py-4">
          <button onClick={() => router.push("/search")} className="w-full flex items-center gap-3 px-4 py-3 glass-sm rounded-xl mb-4 text-dark-400 hover:bg-white/5 transition-colors">
            <Search className="w-5 h-5" />
            <span>Search incidents, #tags, locations...</span>
          </button>

          <div className="flex items-center gap-2 mb-4">
            <Button variant={activeTab === "nearby" ? "primary" : "secondary"} size="sm" onClick={() => { setActiveTab("nearby"); applyCachedFeed(`home:nearby:${showSeenNearby ? "seen" : "unseen"}`); }} leftIcon={<MapPin className="w-4 h-4" />}>Nearby</Button>
            <Button variant={activeTab === "trending" ? "primary" : "secondary"} size="sm" onClick={() => { setActiveTab("trending"); applyCachedFeed(`home:trending:${trendingMode}:${showSeenTop ? "seen" : "unseen"}`); }} leftIcon={<TrendingUp className="w-4 h-4" />}>Trending</Button>
            <button onClick={() => fetchPosts(true)} disabled={refreshing} className="ml-auto p-2 glass-sm rounded-lg hover:bg-white/10">
              <RefreshCw className={`w-4 h-4 text-dark-400 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>

          {activeTab === "trending" && (
            <div className="flex items-center gap-2 mb-4">
              <div className="flex gap-1 glass-sm rounded-xl p-1">
                <button type="button" onClick={() => { setTrendingMode("recommended"); applyCachedFeed(`home:trending:recommended:${showSeenTop ? "seen" : "unseen"}`); }} className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${trendingMode === "recommended" ? "bg-primary-600 text-white" : "text-dark-300 hover:bg-white/10"}`}>Recommended</button>
                <button type="button" onClick={() => { setTrendingMode("top"); applyCachedFeed(`home:trending:top:${showSeenTop ? "seen" : "unseen"}`); }} className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${trendingMode === "top" ? "bg-primary-600 text-white" : "text-dark-300 hover:bg-white/10"}`}>Top</button>
              </div>
              <button type="button" onClick={() => setShowSeenTop((v) => !v)} className="px-3 py-1.5 text-xs glass-sm rounded-xl text-dark-300 hover:bg-white/10">{showSeenTop ? "Hide seen" : "Show seen"}</button>
            </div>
          )}

          {activeTab === "nearby" && (
            <div className="flex justify-end mb-3">
              <button type="button" onClick={() => setShowSeenNearby(v => !v)} className="px-3 py-1.5 text-xs glass-sm rounded-xl text-dark-300 hover:bg-white/10">{showSeenNearby ? "Hide seen" : "Show seen"}</button>
            </div>
          )}

          {loading && posts.length === 0 ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => <PostCardSkeleton key={i} />)}
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12 text-dark-400">No alerts found nearby.</div>
          ) : (
            <div className="space-y-4">
              {refreshing && <div className="flex justify-center py-2"><Loader2 className="w-5 h-5 text-primary-500 animate-spin" /></div>}
              {posts.map((post) => (
                <PostCard key={post.id} post={post} sourceKey={feedKey} onConfirm={() => {}} onShare={handleSharePost} />
              ))}
            </div>
          )}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}