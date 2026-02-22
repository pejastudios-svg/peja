"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import { apiUrl } from "@/lib/api";
import { PejaLoadingScreen } from "@/components/ui/PejaLoadingScreen";
import { usePageCache } from "@/context/PageCacheContext";

type FeedTab = "nearby" | "trending";
type TrendingMode = "recommended" | "top";

interface HomeUIState {
  activeTab: FeedTab;
  trendingMode: TrendingMode;
  showSeenTop: boolean;
  showSeenNearby: boolean;
}

const DEFAULT_UI: HomeUIState = {
  activeTab: "nearby",
  trendingMode: "recommended",
  showSeenTop: false,
  showSeenNearby: false,
};

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
  } catch {
    return {};
  }
}

function isHideableSeen(store: SeenStore, postId: string) {
  const t = store[postId];
  if (typeof t !== "number") return false;
  return Date.now() - t >= SEEN_GRACE_MS;
}

const PRIORITY_CATEGORIES = new Set(["crime", "fire", "kidnapping", "terrorist"]);

function categoryPriority(p: Post): number {
  if (PRIORITY_CATEGORIES.has(p.category)) return 0;
  if (p.category === "general") return 2;
  return 1;
}

function engagementScore(p: Post) {
  return (p.confirmations || 0) * 10 + (p.comment_count || 0) * 4 + Math.min(p.views || 0, 5000) * 0.2;
}

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

export default function Home() {
  // ============================================================
  // ALL HOOKS — no early returns above this section
  // ============================================================

  const confirm = useConfirm();
  const router = useRouter();
  const { user, loading: authLoading, session } = useAuth();
  const feedCache = useFeedCache();
  const pageCache = usePageCache();
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  const fetchInProgressRef = useRef(false);

  // Restore UI state from PageCache (instant, no flash)
  const cachedUI = pageCache.getMeta<HomeUIState>("home:ui");
  const initialUI = cachedUI || DEFAULT_UI;

  const [activeTab, setActiveTab] = useState<FeedTab>(initialUI.activeTab);
  const [trendingMode, setTrendingMode] = useState<TrendingMode>(initialUI.trendingMode);
  const [showSeenTop, setShowSeenTop] = useState<boolean>(initialUI.showSeenTop);
  const [showSeenNearby, setShowSeenNearby] = useState<boolean>(initialUI.showSeenNearby);
  const [authCheckDone, setAuthCheckDone] = useState(false);

  const feedKey = activeTab === "trending"
    ? `home:trending:${showSeenTop ? "seen" : "unseen"}`
    : `home:nearby:${showSeenNearby ? "seen" : "unseen"}`;

  // Initialize posts from feed cache — zero loading flash when returning
  const [posts, setPosts] = useState<Post[]>(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get(feedKey);
      if (cached?.posts?.length) return cached.posts;
    }
    return [];
  });

  const [loading, setLoading] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get(feedKey);
      if (cached?.posts?.length) return false;
    }
    return true;
  });

  const [refreshing, setRefreshing] = useState(false);

  // Track if this is a return visit (have cached data) vs first visit
  const isReturnVisit = useRef(false);
  useEffect(() => {
    const cached = feedCache.get(feedKey);
    if (cached?.posts?.length) {
      isReturnVisit.current = true;
    }
  }, []);

  const applyCachedFeed = useCallback(
    (key: string) => {
      const cached = feedCache.get(key);
      if (cached?.posts?.length) {
        setPosts(cached.posts);
        setLoading(false);
      }
    },
    [feedCache]
  );

  // Persist UI state to PageCache (in-memory, survives tab switches)
  useEffect(() => {
    pageCache.setMeta<HomeUIState>("home:ui", {
      activeTab,
      trendingMode,
      showSeenTop,
      showSeenNearby,
    });
  }, [activeTab, trendingMode, showSeenTop, showSeenNearby, pageCache]);

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
        media:
          media?.map((m: any) => ({
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

  const fetchPosts = useCallback(
    async (isRefresh = false) => {
      if (fetchInProgressRef.current && !isRefresh) return;
      fetchInProgressRef.current = true;

      const cached = feedCache.get(feedKey);
      const hasCachedData = cached && cached.posts.length > 0;

      // If not refreshing and we have cached data, show it immediately
      // Then do a background revalidation
      if (!isRefresh && hasCachedData) {
        setPosts(cached.posts);
        setLoading(false);

        // Always hydrate confirmations from cached posts
        confirm.hydrateCounts(
          cached.posts.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 }))
        );
        confirm.loadConfirmedFor(cached.posts.map((p) => p.id));

        // Stale-while-revalidate: if cache is older than 60 seconds, silently refresh
        const cacheAge = Date.now() - (cached.updatedAt || 0);
        if (cacheAge < 60000) {
          fetchInProgressRef.current = false;
          return; // Cache is fresh enough, skip fetch
        }
        // Otherwise fall through to fetch in background (no loading indicator)
      }

      if (isRefresh) {
        setRefreshing(true);
      } else if (!hasCachedData) {
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
          const res = await supabase
            .from("posts")
            .select(baseSelect)
            .in("status", ["live", "resolved"])
            .order("created_at", { ascending: false })
            .limit(200);

          data = res.data;
          error = res.error;
        } else {
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
          if (!hasCachedData) setPosts([]);
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
          media:
            post.post_media?.map((m: any) => ({
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
          const baseList = showSeenNearby
            ? formattedPosts
            : formattedPosts.filter((p) => !isHideableSeen(seenStore, p.id));
          const userLat = userRef.current?.last_latitude ?? null;
          const userLng = userRef.current?.last_longitude ?? null;

          if (userLat != null && userLng != null) {
            finalPosts = [...baseList].sort((a, b) => {
              const pa = categoryPriority(a);
              const pb = categoryPriority(b);
              if (pa !== pb) return pa - pb;

              const aLat = a.location?.latitude ?? 0;
              const aLng = a.location?.longitude ?? 0;
              const bLat = b.location?.latitude ?? 0;
              const bLng = b.location?.longitude ?? 0;

              const aHas = !!aLat && !!aLng;
              const bHas = !!bLat && !!bLng;

              if (!aHas && bHas) return 1;
              if (aHas && !bHas) return -1;
              if (!aHas && !bHas) {
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              }

              const da = distanceKm(userLat, userLng, aLat, aLng);
              const db = distanceKm(userLat, userLng, bLat, bLng);

              if (da !== db) return da - db;

              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });

            finalPosts = finalPosts.slice(0, 30);
          } else {
            finalPosts = [...baseList]
              .sort((a, b) => {
                const pa = categoryPriority(a);
                const pb = categoryPriority(b);
                if (pa !== pb) return pa - pb;
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              })
              .slice(0, 30);
          }
        } else {
          const base = showSeenTop
            ? formattedPosts
            : formattedPosts.filter((p) => !isHideableSeen(seenStore, p.id));

          finalPosts = base
            .sort((a, b) => {
              const pa = categoryPriority(a);
              const pb = categoryPriority(b);
              if (pa !== pb) return pa - pb;
              return engagementScore(b) - engagementScore(a);
            })
            .slice(0, 30);
        }

        confirm.hydrateCounts(
          finalPosts.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 }))
        );
        confirm.loadConfirmedFor(finalPosts.map((p) => p.id));

        setPosts(finalPosts);
        feedCache.setPosts(feedKey, finalPosts);
      } catch (err) {
        console.error("Fetch error:", err);
        if (!hasCachedData) setPosts([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
        fetchInProgressRef.current = false;
      }
    },
      [activeTab, feedKey, feedCache, trendingMode, showSeenTop, showSeenNearby, confirm]
  );

  // Listen for new post created event
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
        setPosts((prev) => {
          const next = prev.filter((p) => p.id !== postId);
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
        setPosts((prev) => {
          const next = prev.filter((p) => p.id !== postId);
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

  // Initial fetch with stale-while-revalidate
  useEffect(() => {
    if (!authLoading) {
      const needsRefresh = sessionStorage.getItem("peja-feed-refresh");
      if (needsRefresh) {
        sessionStorage.removeItem("peja-feed-refresh");
        feedCache.invalidateAll();
        fetchPosts(true);
      } else {
        fetchPosts();
      }
    }
  }, [activeTab, authLoading, fetchPosts, feedCache]);

  // Expire job
  useEffect(() => {
    if (!session?.access_token) return;

    fetch(apiUrl("/api/jobs/expire"), {
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
            setPosts((prev) => {
              const merged = [formatted, ...prev];

              if (activeTab === "nearby") {
                const userLat = userRef.current?.last_latitude ?? null;
                const userLng = userRef.current?.last_longitude ?? null;

                if (userLat != null && userLng != null) {
                  const sorted = merged.sort((a, b) => {
                    const aHas = !!a.location?.latitude && !!a.location?.longitude;
                    const bHas = !!b.location?.latitude && !!b.location?.longitude;
                    if (!aHas && bHas) return 1;
                    if (aHas && !bHas) return -1;
                    if (!aHas && !bHas)
                      return (
                        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                      );

                    const da = distanceKm(
                      userLat,
                      userLng,
                      a.location.latitude,
                      a.location.longitude
                    );
                    const db = distanceKm(
                      userLat,
                      userLng,
                      b.location.latitude,
                      b.location.longitude
                    );
                    if (da !== db) return da - db;
                    return (
                      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                    );
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
          }
        }
      },
      // On post update
      (updatedPost) => {
        console.log("[Realtime] Post updated:", updatedPost.id, "status:", updatedPost.status);

        setPosts((prev) => {
          if (updatedPost.status === "archived" || updatedPost.status === "deleted") {
            console.log("[Realtime] Removing archived post:", updatedPost.id);
            const next = prev.filter((p) => p.id !== updatedPost.id);
            feedCache.setPosts(feedKey, next);
            return next;
          }

          const next = prev
            .map((p) => {
              if (p.id === updatedPost.id) {
                return {
                  ...p,
                  confirmations: updatedPost.confirmations ?? p.confirmations,
                  views: updatedPost.views ?? p.views,
                  comment_count: updatedPost.comment_count ?? p.comment_count,
                  report_count: updatedPost.report_count ?? p.report_count,
                  status: updatedPost.status ?? p.status,
                  is_sensitive: updatedPost.is_sensitive ?? p.is_sensitive,
                };
              }
              return p;
            })
            .filter((p) => p.status === "live" || p.status === "resolved");

          feedCache.setPosts(feedKey, next);
          return next;
        });
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
  }, [formatPost, feedKey, feedCache, activeTab]);

  // Prefetch routes
  useEffect(() => {
    router.prefetch("/map");
    router.prefetch("/notifications");
    router.prefetch("/profile");
  }, [router]);

  // Save scroll position to FeedContext
  // (ScrollRestorer's global listener handles the position Map automatically)
  useEffect(() => {
    const save = () => {
      feedCache.setScroll(feedKey, window.scrollY);
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [feedKey, feedCache]);

  // Auth redirect
  useEffect(() => {
    if (authLoading) return;

    if (user) {
      setAuthCheckDone(true);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const {
          data: { session: freshSession },
        } = await supabase.auth.getSession();

        if (freshSession?.user) {
          console.log("[Home] Session found on recheck, waiting for user state...");
          setTimeout(() => {
            setAuthCheckDone(true);
          }, 1000);
          return;
        }

        console.log("[Home] No session found, redirecting to login");
        router.push("/login");
      } catch {
        router.push("/login");
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [authLoading, user, router]);

  // Share handler
  const handleSharePost = useCallback(
    async (post: Post) => {
      const shareUrl = `${window.location.origin}/post/${post.id}`;
      if (navigator.share) {
        try {
          await navigator.share({ title: "Peja Alert", url: shareUrl });
        } catch {}
      } else {
        await navigator.clipboard.writeText(shareUrl);
        alert("Link copied!");
      }
    },
    []
  );

  // Refresh handler
  const handleRefresh = useCallback(() => {
    fetchPosts(true);
  }, [fetchPosts]);

  // ============================================================
  // ALL HOOKS ARE DONE — early returns are now safe
  // ============================================================

  if (posts.length === 0 && (authLoading || (!user && !authCheckDone))) {
    return <PejaLoadingScreen />;
  }

  if (posts.length === 0 && !user) {
    return <PejaLoadingScreen />;
  }

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header onCreateClick={() => router.push("/create")} />

      <main className="pt-14">
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
                onClick={() => setShowSeenNearby((v) => !v)}
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
            <div className="text-center py-12">No posts yet.</div>
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
      </main>

      <BottomNav />
    </div>
  );
}