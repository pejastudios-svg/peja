"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { Header } from "@/components/layout/Header";
import { PostCard } from "@/components/posts/PostCard";
import { Button } from "@/components/ui/Button";
import { BatteryOptimizationBanner } from "@/components/system/BatteryOptimizationBanner";
import { Post } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { realtimeManager } from "@/lib/realtime";
import { useFeedCache } from "@/context/FeedContext";
import { useConfirm } from "@/context/ConfirmContext";
import { PostCardSkeleton } from "@/components/posts/PostCardSkeleton";
import { usePageCache } from "@/context/PageCacheContext";
import { preloadFeedVideos, getVideoThumbnailUrl } from "@/lib/videoThumbnail";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { profileCompletion } from "@/lib/profileComplete";
import { isNigeriaPost } from "@/lib/notifications";

// Nearby tab radius. Hard-coded by product: no toggle, no slider.
const NEARBY_RADIUS_KM = 50;

type FeedTab = "nearby" | "trending";
type TrendingMode = "recommended" | "top";

interface HomeUIState {
  activeTab: FeedTab;
  trendingMode: TrendingMode;
}

const DEFAULT_UI: HomeUIState = {
  activeTab: "nearby",
  trendingMode: "recommended",
};

const PRIORITY_CATEGORIES = new Set(["kidnapping", "terrorist"]);

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
  const { user, loading: authLoading } = useAuth();

  // The feed is account-only now; guests get the onboarding pitch.
  useEffect(() => {
    if (!authLoading && !user) router.replace("/welcome");
  }, [authLoading, user, router]);
  const feedCache = useFeedCache();
  const pageCache = usePageCache();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Restore UI state from PageCache (instant, no flash)
  const cachedUI = pageCache.getMeta<HomeUIState>("home:ui");
  const initialUI = cachedUI || DEFAULT_UI;

  const [activeTab, setActiveTab] = useState<FeedTab>(initialUI.activeTab);
  const [trendingMode, setTrendingMode] = useState<TrendingMode>(initialUI.trendingMode);
  const [authCheckDone, setAuthCheckDone] = useState(false);

  const feedKey = activeTab === "trending" ? "home:trending" : "home:nearby";

  // Initialize posts from feed cache — zero loading flash when returning
  const [posts, setPosts] = useState<Post[]>(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get(feedKey);
      if (cached?.posts?.length) return feedCache.applyOverlay(cached.posts);
    }
    return feedCache.applyOverlay([]);
  });

  const [loading, setLoading] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get(feedKey);
      if (cached?.posts?.length) return false;
    }
    return true;
  });

  const [refreshing, setRefreshing] = useState(false);
  // True when the last fetch failed AND we have nothing cached to show, so we
  // can render a real error+retry instead of a misleading "no posts" state.
  const [feedError, setFeedError] = useState(false);
  // Cache of the other tab's posts for smooth swiping
  const [nearbyPosts, setNearbyPosts] = useState<Post[]>(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get("home:nearby");
      if (cached?.posts?.length) return feedCache.applyOverlay(cached.posts);
    }
    return feedCache.applyOverlay([]);
  });
  const [trendingPosts, setTrendingPosts] = useState<Post[]>(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get("home:trending");
      if (cached?.posts?.length) return feedCache.applyOverlay(cached.posts);
    }
    return feedCache.applyOverlay([]);
  });
  // Swipe state
  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
    setIsSwiping(false);
  }, []);

 const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swipeStartRef.current) return;
    const dx = e.touches[0].clientX - swipeStartRef.current.x;
    const dy = e.touches[0].clientY - swipeStartRef.current.y;
    
    // First 10px determines direction
    if (!isSwiping && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    
    // If vertical wins, cancel swipe entirely
    if (!isSwiping && Math.abs(dy) > Math.abs(dx)) {
      swipeStartRef.current = null;
      return;
    }
    
    // Horizontal swipe detected - lock it
    setIsSwiping(true);
    e.preventDefault(); // Prevent vertical scroll
    
    const maxSwipe = window.innerWidth * 0.5;
    const limited = Math.max(-maxSwipe, Math.min(maxSwipe, dx));
    
    if ((activeTab === "nearby" && dx > 0) || (activeTab === "trending" && dx < 0)) {
      setSwipeOffset(limited * 0.15);
    } else {
      setSwipeOffset(limited);
    }
  }, [activeTab, isSwiping]);

  const handleTouchEnd = useCallback(() => {
    if (!swipeStartRef.current) { setSwipeOffset(0); return; }
    const threshold = window.innerWidth * 0.15;
    
    if (swipeOffset < -threshold && activeTab === "nearby") {
      setActiveTab("trending");
      applyCachedFeed("home:trending");
    } else if (swipeOffset > threshold && activeTab === "trending") {
      setActiveTab("nearby");
      applyCachedFeed("home:nearby");
    }
    
    setSwipeOffset(0);
    setIsSwiping(false);
    swipeStartRef.current = null;
  }, [swipeOffset, activeTab]);
  // Preload first videos from cache immediately on mount. The thumbnail
  // warm-up lives INSIDE the effect — it used to sit bare in the render body,
  // so it re-ran on every render (including every touchmove frame during a tab
  // swipe), allocating Image objects ~60x/sec.
  useEffect(() => {
    if (posts.length > 0) {
      preloadFeedVideos(posts);
      for (const p of posts as any[]) {
        for (const m of p.media || []) {
          if (m.media_type === "video") {
            const thumb = m.thumbnail_url || getVideoThumbnailUrl(m.url);
            if (thumb) { const img = new Image(); img.src = thumb; }
          }
        }
      }
    }
  }, []);
  // ── Stable refs: prevent fetchPosts from being recreated on every
  //    auth / confirm context update ──
  const userRef = useRef(user);
  const confirmRef = useRef(confirm);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { confirmRef.current = confirm; }, [confirm]);

  // Guard against concurrent fetches
  const fetchingRef = useRef(false);
  // Tracks which feedKey the in-flight fetch is for, so tab switches don't
  // dedupe away the new tab's fetch.
  const fetchingKeyRef = useRef<string | null>(null);

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
        const overlaid = feedCache.applyOverlay(cached.posts);
        setPosts(overlaid);
        if (key === "home:nearby") setNearbyPosts(overlaid);
        else if (key === "home:trending") setTrendingPosts(overlaid);
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
    });
  }, [activeTab, trendingMode, pageCache]);

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
      // ── Deduplicate, but only against a fetch for the SAME tab. Previously
      //    this dropped the new tab's fetch when you switched tabs mid-fetch,
      //    leaving e.g. Trending stuck on "No trending posts yet" until a
      //    manual pull-to-refresh. A different-key fetch is allowed through. ──
      if (fetchingRef.current && !isRefresh && fetchingKeyRef.current === feedKey) return;
      fetchingRef.current = true;
      fetchingKeyRef.current = feedKey;

      const cached = feedCache.get(feedKey);
      const hasCachedData = cached && cached.posts.length > 0;

      // If not refreshing and we have cached data, show it immediately
      // Then do a background revalidation
      if (!isRefresh && hasCachedData) {
        setPosts(feedCache.applyOverlay(cached.posts));
        setLoading(false);

        // Stale-while-revalidate: if cache is older than 60 seconds, silently refresh
        const cacheAge = Date.now() - (cached.updatedAt || 0);
        if (cacheAge < 60000) {
          fetchingRef.current = false;
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
          latitude, longitude, country_code,
          is_anonymous, status, is_sensitive, confirmations, views, comment_count, report_count, created_at,
          post_media (id, url, media_type, is_sensitive),
          post_tags (tag)
        `;

        let data: any[] | null = null;
        let error: any = null;

        // ── Retry up to 3 times on network failure (iOS cold-start fix) ──
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await supabase
            .from("posts")
            .select(baseSelect)
            .in("status", ["live", "resolved"])
            .order("created_at", { ascending: false })
            .limit(200);

          data = res.data;
          error = res.error;

          if (!error && data) break; // success → exit retry loop
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); // 1.5s, 3s
          }
        }

        if (error || !data) {
          // ── Never wipe posts the user can already see ── flag the error;
          // the empty-state render only shows the retry when the list is
          // actually empty, so this is a no-op when cached posts are visible.
          setFeedError(true);
          return;
        }
        setFeedError(false);

        const formattedPosts: Post[] = (data || []).map((post) => ({
          id: post.id,
          user_id: post.user_id,
          category: post.category,
          comment: post.comment,
          location: {
            latitude: (post as any).latitude ?? 0,
            longitude: (post as any).longitude ?? 0,
          },
          country_code: (post as any).country_code ?? null,
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

        let finalPosts = formattedPosts;

        // ── Read user location from ref (stable, no dep churn) ──
        const currentUser = userRef.current;

        if (activeTab === "nearby") {
          const userLat = currentUser?.last_latitude ?? null;
          const userLng = currentUser?.last_longitude ?? null;

          // Country gate first. Excludes cross-country pollution (e.g. a US
          // post leaking into a Nigerian feed) regardless of whether we
          // know the user's lat/lng. Uses stored country_code when present,
          // bbox fallback for legacy rows.
          const inCountry = formattedPosts.filter((p) =>
            isNigeriaPost(p.country_code, p.location?.latitude, p.location?.longitude),
          );

          if (userLat != null && userLng != null) {
            // Radius gate. Posts with no coords are dropped here — the
            // Nearby tab is by definition about proximity.
            const withinRadius = inCountry.filter((p) => {
              const lat = p.location?.latitude ?? 0;
              const lng = p.location?.longitude ?? 0;
              if (!lat || !lng) return false;
              return distanceKm(userLat, userLng, lat, lng) <= NEARBY_RADIUS_KM;
            });

            finalPosts = [...withinRadius].sort((a, b) => {
              const pa = categoryPriority(a);
              const pb = categoryPriority(b);
              if (pa !== pb) return pa - pb;

              const aLat = a.location?.latitude ?? 0;
              const aLng = a.location?.longitude ?? 0;
              const bLat = b.location?.latitude ?? 0;
              const bLng = b.location?.longitude ?? 0;

              const da = distanceKm(userLat, userLng, aLat, aLng);
              const db = distanceKm(userLat, userLng, bLat, bLng);

              if (da !== db) return da - db;

              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });

            finalPosts = finalPosts.slice(0, 30);
          } else {
            // No user location yet — keep the country gate but skip the
            // radius filter so the feed isn't empty on first paint.
            finalPosts = [...inCountry]
              .sort((a, b) => {
                const pa = categoryPriority(a);
                const pb = categoryPriority(b);
                if (pa !== pb) return pa - pb;
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              })
              .slice(0, 30);
          }
        } else {
          finalPosts = [...formattedPosts]
            .sort((a, b) => {
              const pa = categoryPriority(a);
              const pb = categoryPriority(b);
              if (pa !== pb) return pa - pb;
              return engagementScore(b) - engagementScore(a);
            })
            .slice(0, 30);
        }

        // ── Use confirmRef (stable, no dep churn) ──
        confirmRef.current.hydrateCounts(
          finalPosts.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 }))
        );
        confirmRef.current.loadConfirmedFor(finalPosts.map((p) => p.id));

        // Reconcile pending creates: any whose ID is in the fresh response means
        // the server caught up, so drop them from the overlay. Deletes stay until
        // realtime confirms, to avoid a paginated-out false positive.
        feedCache.reconcile(finalPosts);

        const displayPosts = feedCache.applyOverlay(finalPosts);

        setPosts(displayPosts);
        if (feedKey === "home:nearby") setNearbyPosts(displayPosts);
        else if (feedKey === "home:trending") setTrendingPosts(displayPosts);
        feedCache.setPosts(feedKey, displayPosts);
        preloadFeedVideos(displayPosts);

        // Preload video thumbnails
        finalPosts.forEach((p: any) => {
          p.media?.forEach((m: any) => {
            if (m.media_type === "video") {
              const thumb = m.thumbnail_url || getVideoThumbnailUrl(m.url);
              if (thumb) { const img = new Image(); img.src = thumb; }
            }
          });
        });
        
      } catch (err) {
        // ── Never wipe posts the user can already see ──
        setFeedError(true);
      } finally {
        fetchingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeTab, feedKey, feedCache, trendingMode]
  );

  // ── Keep a ref to the latest fetchPosts so the main effect never
  //    re-fires just because the callback identity changed ──
  const fetchPostsRef = useRef(fetchPosts);
  useEffect(() => { fetchPostsRef.current = fetchPosts; }, [fetchPosts]);

  // Listen for new post created event
  useEffect(() => {
    const handleNewPost = () => {
      fetchPostsRef.current(true);
    };

    window.addEventListener("peja-post-created", handleNewPost);

    return () => {
      window.removeEventListener("peja-post-created", handleNewPost);
    };
  }, []);

  // Listen for post deleted/archived events — remove from all three states
  useEffect(() => {
    const removeById = (postId: string) => {
      setPosts((prev) => {
        const next = prev.filter((p) => p.id !== postId);
        feedCache.setPosts(feedKey, next);
        return next;
      });
      setNearbyPosts((prev) => {
        const next = prev.filter((p) => p.id !== postId);
        feedCache.setPosts("home:nearby", next);
        return next;
      });
      setTrendingPosts((prev) => {
        const next = prev.filter((p) => p.id !== postId);
        feedCache.setPosts("home:trending", next);
        return next;
      });
    };

    const handler = (e: Event) => {
      const { postId } = (e as CustomEvent).detail || {};
      if (postId) removeById(postId);
    };

    window.addEventListener("peja-post-deleted", handler);
    window.addEventListener("peja-post-archived", handler);

    return () => {
      window.removeEventListener("peja-post-deleted", handler);
      window.removeEventListener("peja-post-archived", handler);
    };
  }, [feedKey, feedCache]);
  

  // ── Initial fetch — deps are now stable: feedKey + authLoading ──
  useEffect(() => {
    if (!authLoading) {
      const needsRefresh = sessionStorage.getItem("peja-feed-refresh");
      if (needsRefresh) {
        sessionStorage.removeItem("peja-feed-refresh");
        // Don't invalidateAll — that wipes the optimistic insert the create
        // flow just wrote. The isRefresh=true call below already bypasses
        // the cache-freshness shortcut, so we'll revalidate against the DB
        // either way while keeping the new post visible immediately.
        fetchPostsRef.current(true);
      } else {
        fetchPostsRef.current();
      }
    }
  }, [feedKey, authLoading, feedCache]);

  // Capacitor resume: revalidate against DB (bypasses the 60s cache shortcut).
  useEffect(() => {
    const onForeground = () => {
      if (!authLoading) fetchPostsRef.current(true);
    };
    window.addEventListener("peja-app-foreground", onForeground);
    return () => window.removeEventListener("peja-app-foreground", onForeground);
  }, [authLoading]);

  // Expiry sweep now runs on a schedule via Vercel Cron (see vercel.json),
  // not from every client session. See /api/jobs/expire.

  // Real-time subscription
  useEffect(() => {
    const unsubscribe = realtimeManager.subscribeToPosts(
      // On new post — prepend to both tabs so cross-device inserts show up immediately.
      async (newPost) => {
        if (newPost.status !== "live") return;
        // The feed only ever renders Nigeria posts (country gate below in the
        // fetch path). Bail before the two enrichment queries for anything
        // that could never appear here — otherwise every connected client
        // runs post_media + post_tags lookups for every insert worldwide.
        if (!isNigeriaPost(newPost.country_code, newPost.latitude, newPost.longitude)) return;
        const formatted = await formatPost(newPost);
        if (!formatted) return;

        const prependIfMissing = (list: Post[]): Post[] => {
          if (list.some((p) => p.id === formatted.id)) return list;
          return [formatted, ...list].slice(0, 30);
        };

        setPosts((prev) => {
          const next = prependIfMissing(prev);
          feedCache.setPosts(feedKey, next);
          return next;
        });
        setNearbyPosts((prev) => {
          const next = prependIfMissing(prev);
          feedCache.setPosts("home:nearby", next);
          return next;
        });
        setTrendingPosts((prev) => {
          const next = prependIfMissing(prev);
          feedCache.setPosts("home:trending", next);
          return next;
        });
      },
      // On post update — apply to both tab states (archive-as-delete + live edits)
      (updatedPost) => {
        const applyUpdate = (list: Post[]): Post[] => {
          if (updatedPost.status === "archived" || updatedPost.status === "deleted") {
            return list.filter((p) => p.id !== updatedPost.id);
          }
          return list
            .map((p) =>
              p.id === updatedPost.id
                ? {
                    ...p,
                    confirmations: updatedPost.confirmations ?? p.confirmations,
                    views: updatedPost.views ?? p.views,
                    comment_count: updatedPost.comment_count ?? p.comment_count,
                    report_count: updatedPost.report_count ?? p.report_count,
                    status: updatedPost.status ?? p.status,
                    is_sensitive: updatedPost.is_sensitive ?? p.is_sensitive,
                  }
                : p
            )
            .filter((p) => p.status === "live" || p.status === "resolved");
        };

        setPosts((prev) => {
          const next = applyUpdate(prev);
          feedCache.setPosts(feedKey, next);
          return next;
        });
        setNearbyPosts((prev) => {
          const next = applyUpdate(prev);
          feedCache.setPosts("home:nearby", next);
          return next;
        });
        setTrendingPosts((prev) => {
          const next = applyUpdate(prev);
          feedCache.setPosts("home:trending", next);
          return next;
        });
      },
      // On post delete — filter from BOTH tab states since the rendered lists
      // are nearbyPosts / trendingPosts, not the `posts` alias.
      (deletedPost) => {
        const removeFromList = (list: Post[]) => list.filter((p) => p.id !== deletedPost.id);
        setPosts((prev) => {
          const next = removeFromList(prev);
          feedCache.setPosts(feedKey, next);
          return next;
        });
        setNearbyPosts((prev) => {
          const next = removeFromList(prev);
          feedCache.setPosts("home:nearby", next);
          return next;
        });
        setTrendingPosts((prev) => {
          const next = removeFromList(prev);
          feedCache.setPosts("home:trending", next);
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
    // Don't redirect, just wait
    const timer = setTimeout(() => {
      setAuthCheckDone(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, [authLoading, user, router]);

  // Share handler
  const handleSharePost = useCallback(
    async (post: Post) => {
      const shareUrl = `https://peja.life/post/${post.id}`;
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
  const handleRefresh = useCallback(async () => {
    await fetchPostsRef.current(true);
  }, []);

  // ============================================================
  // ALL HOOKS ARE DONE — early returns are now safe
  // ============================================================

  if (!mounted || (posts.length === 0 && (authLoading || (!user && !authCheckDone)))) {
    return (
      <div className="min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom,0px))]">
        <Header onCreateClick={() => {}} />
        <main
          className="max-w-2xl mx-auto px-4 py-4 space-y-4"
          style={{ paddingTop: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 16px) + 60px)" }}
        >
          {[1, 2, 3].map((i) => <PostCardSkeleton key={i} />)}
        </main>
      </div>
    );
  }

  if (posts.length === 0 && !user) {
    return (
      <div className="min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom,0px))]">
        <Header onCreateClick={() => {}} />
        <main
          className="max-w-2xl mx-auto px-4 py-4 space-y-4"
          style={{ paddingTop: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 16px) + 60px)" }}
        >
          {[1, 2, 3].map((i) => <PostCardSkeleton key={i} />)}
        </main>
      </div>
    );
  }

  // Calculate tab blend ratio for swipe animation (0 = nearby active, 1 = trending active)
  return (
    <div className="min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
      <Header onCreateClick={() => router.push("/create")} />

      <PullToRefresh onRefresh={handleRefresh}>
      <main
        className="hide-scrollbar"
        style={{ paddingTop: "calc(max(var(--app-top-inset, env(safe-area-inset-top, 0px)), 16px) + 60px)" }}
      >
        {user && !profileCompletion(user as any).complete && (
          <div className="max-w-2xl mx-auto px-4 pt-4">
            <div className="glass-card p-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-dark-200">Complete your profile</p>
                <p className="text-xs text-dark-400">
                  Unlock posting, commenting, and the Guardian application. Safety features stay on either way.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => router.push("/profile/edit")}
                className="shrink-0"
              >
                Complete
              </Button>
            </div>
          </div>
        )}

        <BatteryOptimizationBanner />

<div
          className="max-w-2xl mx-auto py-4"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ touchAction: isSwiping ? "none" : "pan-y" }}
        >
<div className="px-4 mb-4">
          <div
            className="flex border-b"
            style={{ borderColor: "var(--glass-border)" }}
            data-tutorial="home-nearby"
          >
            <button
              onClick={() => {
                setActiveTab("nearby");
                applyCachedFeed("home:nearby");
              }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "nearby"
                  ? "text-primary-600 border-b-2 border-primary-600"
                  : "text-dark-400 hover:text-dark-200"
              }`}
            >
              Nearby
            </button>
            <button
              onClick={() => {
                setActiveTab("trending");
                applyCachedFeed("home:trending");
              }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "trending"
                  ? "text-primary-600 border-b-2 border-primary-600"
                  : "text-dark-400 hover:text-dark-200"
              }`}
            >
              Trending
            </button>
          </div>
          </div>
         <div className="overflow-hidden">
            <div
              className="flex"
              style={{
                width: "200%",
                transform: `translateX(calc(${activeTab === "trending" ? "-50%" : "0%"} + ${swipeOffset}px))`,
                transition: isSwiping ? "none" : "transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)",
                willChange: isSwiping ? "transform" : "auto",
              }}
            >
              {/* Nearby feed */}
              <div className="w-1/2 min-w-0 px-0">
                {loading && nearbyPosts.length === 0 && activeTab === "nearby" ? (
                  <div className="space-y-4" data-tutorial="home-feed">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <PostCardSkeleton key={`nearby-skel-${i}`} />
                    ))}
                  </div>
                ) : nearbyPosts.length === 0 ? (
                  feedError ? (
                    <div className="text-center py-12 text-dark-400">
                      <p>Couldn&apos;t load posts. Check your connection.</p>
                      <button
                        onClick={() => fetchPostsRef.current(true)}
                        className="mt-3 px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-medium"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-dark-400">No nearby posts yet.</div>
                  )
                ) : (
                  <div className="space-y-4" data-tutorial="home-feed">
                    {refreshing && activeTab === "nearby" && (
                      <div className="flex justify-center py-2">
                        <PejaSpinner className="w-5 h-5" />
                      </div>
                    )}
                    {nearbyPosts.map((post) => (
                      <PostCard
                        key={`nearby-${post.id}`}
                        post={post}
                        sourceKey="home:nearby"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Trending feed */}
              <div className="w-1/2 min-w-0 px-0">
                {loading && trendingPosts.length === 0 && activeTab === "trending" ? (
                  <div className="space-y-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <PostCardSkeleton key={`trend-skel-${i}`} />
                    ))}
                  </div>
                ) : trendingPosts.length === 0 ? (
                  feedError ? (
                    <div className="text-center py-12 text-dark-400">
                      <p>Couldn&apos;t load posts. Check your connection.</p>
                      <button
                        onClick={() => fetchPostsRef.current(true)}
                        className="mt-3 px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-medium"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-dark-400">No trending posts yet.</div>
                  )
                ) : (
                  <div className="space-y-4">
                    {refreshing && activeTab === "trending" && (
                      <div className="flex justify-center py-2">
                        <PejaSpinner className="w-5 h-5" />
                      </div>
                    )}
                    {trendingPosts.map((post) => (
                      <PostCard
                        key={`trend-${post.id}`}
                        post={post}
                        sourceKey="home:trending"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      </PullToRefresh>
    </div>
  );
}