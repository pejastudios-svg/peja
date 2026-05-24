"use client";

import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES } from "@/lib/types";
import { PostCard } from "@/components/posts/PostCard";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { useFeedCache } from "@/context/FeedContext";
import { useConfirm } from "@/context/ConfirmContext";
import { realtimeManager } from "@/lib/realtime";
import {
  Search,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { PejaSpinner } from "@/components/ui/PejaSpinner";
import { SearchFiltersSheet } from "@/components/search/SearchFiltersSheet";

function SearchContent() {
  // ============================================================
  // ALL HOOKS — no early returns above this section
  // ============================================================

  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState("");
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "all">("all");
  const feedCache = useFeedCache();
  const feedKey = `search:q=${query}|cat=${selectedCategory ?? "all"}|loc=${locationFilter.trim() || "all"}|range=${dateRange}`;

  // --- INSTANT CACHE INITIALIZATION ---
  const [posts, setPosts] = useState<Post[]>(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get(feedKey);
      if (cached?.posts?.length) return feedCache.applyDeletes(cached.posts);
    }
    return [];
  });

  const [loading, setLoading] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = feedCache.get(feedKey);
      if (cached?.posts?.length) return false;
    }
    return posts.length === 0 && !!query;
  });

  // --- SAVE SCROLL ---
  useEffect(() => {
    const save = () => {
      if (window.scrollY > 0) {
        feedCache.setScroll(feedKey, window.scrollY);
      }
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [feedKey, feedCache]);

  const performSearch = useCallback(async () => {
    // Only show loading skeleton if we have NO cached results
    if (posts.length === 0) setLoading(true);

    try {
      let queryBuilder = supabase
        .from("posts")
        .select(
          `
          id, user_id, category, comment, address,
          latitude, longitude,
          is_anonymous, status, is_sensitive,
          confirmations, views, comment_count, report_count, created_at
          `
        )
        .in("status", ["live", "resolved"])
        .order("created_at", { ascending: false })
        .limit(200);

      // Category filter
      if (selectedCategory) {
        queryBuilder = queryBuilder.eq("category", selectedCategory);
      }

      // Date range filter
      if (dateRange !== "all") {
        const now = new Date();
        let startDate: Date;

        switch (dateRange) {
          case "today":
            startDate = new Date(now.setHours(0, 0, 0, 0));
            break;
          case "week":
            startDate = new Date(now.setDate(now.getDate() - 7));
            break;
          case "month":
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            break;
          default:
            startDate = new Date(0);
        }

        queryBuilder = queryBuilder.gte("created_at", startDate.toISOString());
      }

      const { data: postsData, error: postsErr } = await queryBuilder;
      if (postsErr) throw postsErr;

      const rows = postsData || [];
      const postIds = rows.map((p: any) => p.id);

      const [{ data: mediaData, error: mediaErr }, { data: tagsData, error: tagsErr }] =
        await Promise.all([
          postIds.length
            ? supabase
                .from("post_media")
                .select("id,post_id,url,media_type,is_sensitive,thumbnail_url")
                .in("post_id", postIds)
            : Promise.resolve({ data: [], error: null } as any),
          postIds.length
            ? supabase.from("post_tags").select("post_id,tag").in("post_id", postIds)
            : Promise.resolve({ data: [], error: null } as any),
        ]);

      if (mediaErr) { /* skip */ }
      if (tagsErr) { /* skip */ }
      const mediaMap: Record<string, any[]> = {};
      (mediaData || []).forEach((m: any) => {
        if (!mediaMap[m.post_id]) mediaMap[m.post_id] = [];
        mediaMap[m.post_id].push(m);
      });

      const tagsMap: Record<string, string[]> = {};
      (tagsData || []).forEach((t: any) => {
        if (!tagsMap[t.post_id]) tagsMap[t.post_id] = [];
        tagsMap[t.post_id].push(t.tag);
      });

      let formattedPosts: Post[] = rows.map((post: any) => ({
        id: post.id,
        user_id: post.user_id,
        category: post.category,
        comment: post.comment,
        location: {
          latitude: post.latitude ?? 0,
          longitude: post.longitude ?? 0,
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
          (mediaMap[post.id] || []).map((m: any) => ({
            id: m.id,
            post_id: m.post_id,
            url: m.url,
            media_type: m.media_type,
            is_sensitive: m.is_sensitive,
            thumbnail_url: m.thumbnail_url,
          })) || [],
        tags: tagsMap[post.id] || [],
      }));

      // Client-side filtering for search term
      if (query.trim()) {
        const searchTerm = query.toLowerCase().trim();

        if (searchTerm.startsWith("#")) {
          const tagQuery = searchTerm.slice(1);
          formattedPosts = formattedPosts.filter((p) =>
            (p.tags || []).some((t) => (t || "").toLowerCase().includes(tagQuery))
          );
        } else {
          formattedPosts = formattedPosts.filter((p) => {
            const categoryName = CATEGORIES.find((c) => c.id === p.category)?.name || "";
            const comment = (p.comment ?? "").toLowerCase();
            const address = (p.address ?? "").toLowerCase();
            const categoryId = (p.category ?? "").toLowerCase();
            const categoryNameLower = categoryName.toLowerCase();
            const tags = (p.tags ?? []).map((t) => (t ?? "").toLowerCase());

            return (
              comment.includes(searchTerm) ||
              address.includes(searchTerm) ||
              categoryNameLower.includes(searchTerm) ||
              categoryId.includes(searchTerm) ||
              tags.some((t) => t.includes(searchTerm))
            );
          });
        }
      }

      if (locationFilter.trim()) {
        const loc = locationFilter.toLowerCase().trim();
        formattedPosts = formattedPosts.filter((p) =>
          (p.address ?? "").toLowerCase().includes(loc)
        );
      }

      const top = formattedPosts.slice(0, 50);
      const display = feedCache.applyDeletes(top);
      confirm.hydrateCounts(display.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 })));
      confirm.loadConfirmedFor(display.map((p) => p.id));
      setPosts(display);
      feedCache.setPosts(feedKey, display);
    } catch (error) {
      if (posts.length === 0) setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [query, selectedCategory, locationFilter, dateRange, feedKey, feedCache, confirm]);

  // Listen for post deleted/archived events
  useEffect(() => {
    const handlePostDeleted = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { postId } = customEvent.detail || {};

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

  // Realtime: remove posts from search results when they're deleted or archived anywhere
  useEffect(() => {
    const removeById = (postId: string) => {
      setPosts((prev) => {
        const next = prev.filter((p) => p.id !== postId);
        if (next.length !== prev.length) feedCache.setPosts(feedKey, next);
        return next;
      });
    };

    const unsubscribe = realtimeManager.subscribeToPosts(
      undefined,
      (updatedPost: any) => {
        if (
          updatedPost?.status === "archived" ||
          updatedPost?.status === "deleted"
        ) {
          removeById(updatedPost.id);
        }
      },
      (deletedPost: any) => {
        if (deletedPost?.id) removeById(deletedPost.id);
      }
    );

    return () => unsubscribe();
  }, [feedKey, feedCache]);

  const performSearchRef = useRef(performSearch);
  useEffect(() => {
    performSearchRef.current = performSearch;
  }, [performSearch]);

  useEffect(() => {
    const onForeground = () => {
      if (query.trim()) performSearchRef.current();
    };
    window.addEventListener("peja-app-foreground", onForeground);
    return () => window.removeEventListener("peja-app-foreground", onForeground);
  }, [query]);

useEffect(() => {
    const debounce = setTimeout(() => {
      performSearch();
    }, 300);

    return () => clearTimeout(debounce);
  }, [query, selectedCategory, locationFilter, dateRange]);

  // ============================================================
  // ALL HOOKS ARE DONE
  // ============================================================

  const clearFilters = () => {
    setSelectedCategory(null);
    setLocationFilter("");
    setDateRange("all");
  };

  const hasActiveFilters =
    selectedCategory || locationFilter.trim() !== "" || dateRange !== "all";

  // useCallback so the prop reference is stable across renders — otherwise
  // PostCard's React.memo can't skip re-renders of the search results list.
  const handleSharePost = useCallback(async (post: Post) => {
    const shareUrl = `https://peja.life/post/${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Peja Alert", url: shareUrl });
      } catch (error) {}
    } else {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link copied!");
    }
  }, []);

  return (
    <div className="min-h-screen">
      <Header onCreateClick={() => router.push("/create")} />

      <PullToRefresh onRefresh={async () => { await performSearch(); }}>
      <main className="hide-scrollbar pt-app-header-pill pb-app-bottom-nav lg:pb-0">
        <div className="max-w-2xl mx-auto px-4 py-4">
          {/* Search Input */}
          <div className="relative mb-4">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search incidents, #tags, locations, categories..."
              className="w-full pl-12 pr-20 py-3 glass-input"
              autoFocus={posts.length === 0 && !query}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="p-1 hover:bg-white/10 rounded"
                >
                  <X className="w-4 h-4 text-dark-400" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowFilters(true)}
                className={`p-2 rounded-lg transition-colors ${
                  hasActiveFilters
                    ? "bg-primary-600/20 text-primary-400"
                    : "hover:bg-white/10 text-dark-400"
                }`}
                aria-label="Open filters"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Results */}
          {posts.length === 0 && !loading ? (
            <div className="text-center py-12 text-dark-400">No posts yet.</div>
          ) : posts.length === 0 && loading ? (
            <div className="flex justify-center py-12">
              <PejaSpinner className="w-6 h-6" />
            </div>
          ) : (
            <>
              {loading && (
                <div className="flex justify-center py-2">
                  <PejaSpinner className="w-5 h-5" />
                </div>
              )}
              <p className="text-sm text-dark-400 mb-3">
                {posts.length} result{posts.length !== 1 ? "s" : ""}
                {query && ` for "${query}"`}
                {locationFilter.trim() && !query && ` in ${locationFilter.trim()}`}
                {locationFilter.trim() && query && ` · ${locationFilter.trim()}`}
              </p>
            </>
          )}
        </div>

        {posts.length > 0 && (
          <div className="max-w-2xl mx-auto divide-y divide-[var(--border-subtle)]">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onShare={handleSharePost}
                sourceKey={feedKey}
              />
            ))}
            <div className="feed-end-spacer" aria-hidden />
          </div>
        )}
      </main>
      </PullToRefresh>

      <BottomNav />

      <SearchFiltersSheet
        isOpen={showFilters}
        onClose={() => setShowFilters(false)}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        locationFilter={locationFilter}
        onLocationFilterChange={setLocationFilter}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onClearAll={clearFilters}
        hasActiveFilters={!!hasActiveFilters}
        resultCount={posts.length}
      />
    </div>
  );
}

function SearchLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <PejaSpinner className="w-8 h-8" />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchLoading />}>
      <SearchContent />
    </Suspense>
  );
}