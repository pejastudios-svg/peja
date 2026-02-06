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
import { TrendingUp, MapPin, Loader2, Search, RefreshCw, Eye } from "lucide-react";
import { useFeedCache } from "@/context/FeedContext";
import { useConfirm } from "@/context/ConfirmContext";
import { PostCardSkeleton } from "@/components/posts/PostCardSkeleton";
import { useLayoutEffect } from "react"

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
  const applyCachedFeed = (key: string) => {
  const cached = feedCache.get(key);
  if (cached?.posts?.length) {
    setPosts(cached.posts);
    setLoading(false);
  }
};
  const confirm = useConfirm();
  const router = useRouter();
  const { user, loading: authLoading, session } = useAuth();
  const feedCache = useFeedCache(); // Move this up

  const initialUI = loadHomeUI();
  const [activeTab, setActiveTab] = useState<FeedTab>(initialUI.activeTab ?? "nearby");
  type TrendingMode = "recommended" | "top";
  const [trendingMode, setTrendingMode] = useState<TrendingMode>(initialUI.trendingMode ?? "recommended");
  const [showSeenTop, setShowSeenTop] = useState<boolean>(initialUI.showSeenTop ?? false);
  const [showSeenNearby, setShowSeenNearby] = useState(false);
  const [newPostToast, setNewPostToast] = useState<Post | null>(null);


  // --- COMPUTE KEY EARLY ---
  const feedKey = activeTab === "trending"
    ? `home:trending:${showSeenTop ? "seen" : "unseen"}`
    : `home:nearby:${showSeenNearby ? "seen" : "unseen"}`;

  // --- INSTANT RESTORE STATE ---
  // Initialize directly from cache so there is ZERO flash
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
        if (cached?.posts?.length) return false; // Don't load if we have data
     }
     return true;
  });
  const [refreshing, setRefreshing] = useState(false);
  
    useEffect(() => {
  try {
    sessionStorage.setItem(
  HOME_UI_KEY,
  JSON.stringify({ activeTab, trendingMode, showSeenTop, showSeenNearby })
);
  } catch {}
}, [activeTab, trendingMode, showSeenTop]);

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
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
} 

const SEEN_KEY = "peja-seen-posts-v1";
const SEEN_GRACE_MS = 30 * 60 * 1000;

type SeenStore = Record<string, number>;

function readSeenStore(): SeenStore {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);

    // Backwards compatibility: old format was string[]
    if (Array.isArray(parsed)) {
      const m: SeenStore = {};
      for (const id of parsed) if (typeof id === "string") m[id] = 0;
      return m;
    }

    if (parsed && typeof parsed === "object") return parsed as SeenStore;
    return {};
  } catch {
    return {};
  }
}

function isHideableSeen(store: SeenStore, postId: string) {
  const t = store[postId];
  if (typeof t !== "number") return false;
  return Date.now() - t >= SEEN_GRACE_MS;
}

function engagementScore(p: Post) {
  // tune freely later
  return (p.confirmations || 0) * 10 + (p.comment_count || 0) * 4 + Math.min(p.views || 0, 5000) * 0.2;
}

function recommendedScore(p: Post) {
  const ageHours = (Date.now() - new Date(p.created_at).getTime()) / 36e5;
  const e = engagementScore(p);
  // "Hot" style: engagement decays with age
  return e / Math.pow(ageHours + 2, 1.4);
}

  const fetchPosts = useCallback(async (isRefresh = false) => {
    const cached = feedCache.get(feedKey);
const usedCache = !isRefresh && cached && cached.posts.length > 0;

if (usedCache) {
      setPosts(cached.posts);
      setLoading(false);
      return; // <--- ADD THIS. Stop the function here so it doesn't fetch again.
    }


if (isRefresh) {
  setRefreshing(true);
} else if (!usedCache) {
  setLoading(true);
}

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
  // Fetch posts and sort by engagement client-side
  const res = await supabase
    .from("posts")
    .select(baseSelect)
    .in("status", ["live", "resolved"])
    .order("created_at", { ascending: false })
    .limit(200);

  data = res.data;
  error = res.error;
} else {
  // nearby (we’ll sort by distance)
  const res = await supabase
    .from("posts")
    .select(baseSelect)
    .in("status", ["live", "resolved"])
    .order("created_at", { ascending: false })
    .limit(200);

  data = res.data;
  error = res.error;
}

if (error) {
  console.error("Fetch error:", error);
  setPosts([]);
  return;
}

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
        location: {
        latitude: (post as any).latitude ?? 0,
        longitude: (post as any).longitude ?? 0,
        },
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

// Only sort by distance in Nearby tab
if (activeTab === "nearby") {
  const baseList = showSeenNearby ? formattedPosts : formattedPosts.filter(p => !isHideableSeen(seenStore, p.id));
  const userLat = user?.last_latitude ?? null;
  const userLng = user?.last_longitude ?? null;

  if (userLat != null && userLng != null) {
    finalPosts = [...baseList].sort((a, b) => {
      const aLat = a.location?.latitude ?? 0;
      const aLng = a.location?.longitude ?? 0;
      const bLat = b.location?.latitude ?? 0;
      const bLng = b.location?.longitude ?? 0;

      // If a post has no coords, push it down
      const aHas = !!aLat && !!aLng;
      const bHas = !!bLat && !!bLng;

      if (!aHas && bHas) return 1;
      if (aHas && !bHas) return -1;
      if (!aHas && !bHas) {
        // fallback: newest first
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }

      const da = distanceKm(userLat, userLng, aLat, aLng);
      const db = distanceKm(userLat, userLng, bLat, bLng);

      if (da !== db) return da - db;

      // tie-breaker: newest first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // keep feed size sane
    finalPosts = finalPosts.slice(0, 30);
  } else {
    // If we don't know user coords, fallback to newest
    finalPosts = [...baseList]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 30);
  }
} else {
  // Trending tab: sort by engagement (confirmations + views + comments)
  const base = showSeenTop
    ? formattedPosts
    : formattedPosts.filter((p) => !isHideableSeen(seenStore, p.id));

  finalPosts = base
    .sort((a, b) => engagementScore(b) - engagementScore(a))
    .slice(0, 30);
}

confirm.hydrateCounts(finalPosts.map(p => ({ postId: p.id, confirmations: p.confirmations || 0 })));
confirm.loadConfirmedFor(finalPosts.map(p => p.id));

setPosts(finalPosts);
feedCache.setPosts(feedKey, finalPosts);   
 } catch (err) {
      console.error("Fetch error:", err);
      setPosts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab, feedKey, feedCache, trendingMode, showSeenTop, user]);

  // Listen for new post created event (from create page)
useEffect(() => {
  const handleNewPost = () => {
    console.log("[Home] New post created, refreshing feed...");
    fetchPosts(true);
  };

  window.addEventListener("peja-post-created", handleNewPost);
  
  return () => {
    window.removeEventListener("peja-post-created", handleNewPost);
  };
}, [fetchPosts]);

// Listen for post deleted/archived events
useEffect(() => {
  const handlePostDeleted = (e: Event) => {
    const customEvent = e as CustomEvent;
    const { postId } = customEvent.detail || {};
    console.log("[Home] Post deleted event received:", postId);
    
    if (postId) {
      setPosts(prev => {
        const next = prev.filter(p => p.id !== postId);
        feedCache.setPosts(feedKey, next);
        return next;
      });
    }
  };

  const handlePostArchived = (e: Event) => {
    const customEvent = e as CustomEvent;
    const { postId } = customEvent.detail || {};
    console.log("[Home] Post archived event received:", postId);
    
    if (postId) {
      setPosts(prev => {
        const next = prev.filter(p => p.id !== postId);
        feedCache.setPosts(feedKey, next);
        return next;
      });
    }
  };

  window.addEventListener("peja-post-deleted", handlePostDeleted);
  window.addEventListener("peja-post-archived", handlePostArchived);
  
  return () => {
    window.removeEventListener("peja-post-deleted", handlePostDeleted);
    window.removeEventListener("peja-post-archived", handlePostArchived);
  };
}, [feedKey, feedCache]);

  // Initial fetch + check for refresh flag
  useEffect(() => {
    if (!authLoading) {
      // Check if we need to force refresh (after create/delete)
      const needsRefresh = sessionStorage.getItem("peja-feed-refresh");
      if (needsRefresh) {
        sessionStorage.removeItem("peja-feed-refresh");
        feedCache.invalidateAll();
        fetchPosts(true); // Force refresh
      } else {
        fetchPosts();
      }
    }
  }, [activeTab, authLoading, fetchPosts, feedCache]);

  useEffect(() => {
  if (!session?.access_token) return;

  fetch("/api/jobs/expire", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
  }).catch(() => {});
}, [session?.access_token]);


  // Real-time subscription
useEffect(() => {
  const unsubscribe = realtimeManager.subscribeToPosts(
    // On new post
    async (newPost) => {
      if (newPost.status === "live") {
        const formatted = await formatPost(newPost);
        if (formatted) {
          // Check if post is nearby (within 10km)
          const userLat = user?.last_latitude;
          const userLng = user?.last_longitude;
          const postLat = formatted.location?.latitude;
          const postLng = formatted.location?.longitude;
          
          let isNearby = false;
          if (userLat && userLng && postLat && postLng) {
            const distance = distanceKm(userLat, userLng, postLat, postLng);
            isNearby = distance <= 10; // Within 10km
          }
          
          setPosts((prev) => {
            const merged = [formatted, ...prev];

            if (activeTab === "nearby") {
              if (userLat != null && userLng != null) {
                const sorted = merged.sort((a, b) => {
                  const aHas = !!a.location?.latitude && !!a.location?.longitude;
                  const bHas = !!b.location?.latitude && !!b.location?.longitude;
                  if (!aHas && bHas) return 1;
                  if (aHas && !bHas) return -1;
                  if (!aHas && !bHas) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

                  const da = distanceKm(userLat, userLng, a.location.latitude, a.location.longitude);
                  const db = distanceKm(userLat, userLng, b.location.latitude, b.location.longitude);
                  if (da !== db) return da - db;
                  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                });

                const next = sorted.slice(0, 30);
                feedCache.setPosts(feedKey, next);
                return next;
              }
            }

            const next = merged.slice(0, 30);
            feedCache.setPosts(feedKey, next);
            return next;
          });
          
          // Show toast for nearby posts
          if (isNearby && activeTab === "nearby") {
            setNewPostToast(formatted);
            setTimeout(() => setNewPostToast(null), 5000);
          }
        }
      }
    }, 
      // On post delete
      (deletedPost) => {
        setPosts((prev) => {
  const next = prev.filter((p) => p.id !== deletedPost.id);
  feedCache.setPosts(feedKey, next);
  return next;
});
      }
    );

    return () => unsubscribe();
  }, [formatPost, feedKey, feedCache, activeTab, user]);

  useEffect(() => {
  router.prefetch("/map");
  router.prefetch("/notifications");
  router.prefetch("/profile");
}, [router]);

  const handleRefresh = () => {
    fetchPosts(true);
  };

// ✅ CRITICAL: Restore scroll from sessionStorage on mount
useLayoutEffect(() => {
  try {
    const saved = sessionStorage.getItem("peja-scroll-restore");
    if (!saved) return;
    
    const { key, scrollY, timestamp } = JSON.parse(saved);
    
    // Only restore if it's recent (within 30 seconds) and matches our feedKey
    const isRecent = Date.now() - timestamp < 30000;
    const matchesKey = key === feedKey;
    
    console.log("[Home] Checking scroll restore:", { key, scrollY, isRecent, matchesKey, feedKey });
    
    if (isRecent && matchesKey && scrollY > 0) {
      console.log("[Home] Restoring scroll to:", scrollY);
      
      // Clear immediately so we don't restore twice
      sessionStorage.removeItem("peja-scroll-restore");
      
      // Restore scroll
      window.scrollTo(0, scrollY);
      
      // Also try after paint in case content isn't ready
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollY);
      });
    }
  } catch (e) {
    console.error("[Home] Scroll restore error:", e);
  }
}, [feedKey]);

// Keep existing scroll save effect
useEffect(() => {
  const save = () => feedCache.setScroll(feedKey, window.scrollY);
  window.addEventListener("scroll", save, { passive: true });
  return () => window.removeEventListener("scroll", save);
}, [feedKey]);

// ✅ ADD THIS NEW EFFECT - Restore scroll when returning from watch
useEffect(() => {
  console.log("[Home] Restore effect running, feedKey:", feedKey);
  
  const checkAndRestore = () => {
    const flag = sessionStorage.getItem("peja-returning-from-watch");
    console.log("[Home] Flag value:", flag);
    
    if (!flag) {
      console.log("[Home] No flag, skipping restore");
      return;
    }
    
    sessionStorage.removeItem("peja-returning-from-watch");
    
    const cached = feedCache.get(feedKey);
    console.log("[Home] Cached data:", { scrollY: cached?.scrollY, postsCount: cached?.posts?.length });
    
    if (cached && cached.scrollY > 0) {
      console.log("[Home] Attempting to restore scroll to:", cached.scrollY);
      
      const restore = () => {
        window.scrollTo(0, cached.scrollY);
        console.log("[Home] After scrollTo, actual scroll:", window.scrollY);
      };
      
      restore();
      requestAnimationFrame(restore);
      setTimeout(restore, 50);
      setTimeout(restore, 150);
    }
  };

  checkAndRestore();

  const handlePopState = () => {
    console.log("[Home] popstate event fired");
    setTimeout(checkAndRestore, 10);
  };
  
  window.addEventListener("popstate", handlePopState);
  
  return () => {
    window.removeEventListener("popstate", handlePopState);
  };
}, [feedKey, feedCache]);

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

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
    <Header onCreateClick={() => router.push("/create")} />

            <main className="pt-16">
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
              onClick={() => {
             const nextKey = `home:nearby:${showSeenNearby ? "seen" : "unseen"}`;
             setActiveTab("nearby");
             applyCachedFeed(nextKey);
            }}
              leftIcon={<MapPin className="w-4 h-4" />}
            >
              Nearby
            </Button>
            <Button 
              variant={activeTab === "trending" ? "primary" : "secondary"} 
              size="sm" 
              onClick={() => {
              const nextKey = `home:trending:${trendingMode}:${showSeenTop ? "seen" : "unseen"}`;
             setActiveTab("trending");
              applyCachedFeed(nextKey);
              }}
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

          {activeTab === "trending" && (
  <div className="flex justify-end mb-3">
    <button
      type="button"
      onClick={() => setShowSeenTop((v) => !v)}
      className="flex items-center gap-2 px-3 py-1.5 text-xs glass-sm rounded-xl text-dark-300 hover:bg-white/10 transition-colors"
    >
      <Eye className={`w-3.5 h-3.5 ${showSeenTop ? "text-primary-400" : "text-dark-400"}`} />
      {showSeenTop ? "Hide seen" : "Show seen"}
    </button>
  </div>
)}

{activeTab === "nearby" && (
  <div className="flex justify-end mb-3">
    <button
      type="button"
      onClick={() => setShowSeenNearby(v => !v)}
      className="flex items-center gap-2 px-3 py-1.5 text-xs glass-sm rounded-xl text-dark-300 hover:bg-white/10 transition-colors"
    >
      <Eye className={`w-3.5 h-3.5 ${showSeenNearby ? "text-primary-400" : "text-dark-400"}`} />
      {showSeenNearby ? "Hide seen" : "Show seen"}
    </button>
  </div>
)}
          {loading && posts.length === 0 ? (
  <div className="space-y-4">
    {Array.from({ length: 5 }).map((_, i) => (
      <PostCardSkeleton key={i} />
    ))}
  </div>
) : posts.length === 0 ? (
  // keep your existing empty state
  <div className="text-center py-12">...</div>
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
        sourceKey={feedKey}
        onConfirm={() => {}}
        onShare={handleSharePost}
      />
    ))}
  </div>
)}
        </div>
        {/* New nearby post toast */}
{newPostToast && activeTab === "nearby" && (
  <div 
    className="fixed top-20 left-1/2 -translate-x-1/2 z-50 glass-float rounded-xl p-3 flex items-center gap-3 cursor-pointer animate-slide-down max-w-sm"
    onClick={() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setNewPostToast(null);
    }}
  >
    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
    <span className="text-sm text-dark-100">New incident nearby</span>
    <span className="text-xs text-primary-400">Tap to view</span>
  </div>
)}
      </main>

      <BottomNav />
    </div>
  );
}