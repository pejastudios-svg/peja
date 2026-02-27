"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES } from "@/lib/types";
import { PostCard } from "@/components/posts/PostCard";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { useFeedCache } from "@/context/FeedContext";
import { useConfirm } from "@/context/ConfirmContext";
import { PostCardSkeleton } from "@/components/posts/PostCardSkeleton";
import {
  Search,
  X,
  Loader2,
  SlidersHorizontal,
  MapPin,
} from "lucide-react";

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
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "all">("all");
  const feedCache = useFeedCache();
  const feedKey = `search:q=${query}|cat=${selectedCategory ?? "all"}|range=${dateRange}`;

  // --- INSTANT CACHE INITIALIZATION ---
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

      if (mediaErr)      if (tagsErr)
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

      const top = formattedPosts.slice(0, 50);
      confirm.hydrateCounts(top.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 })));
      confirm.loadConfirmedFor(top.map((p) => p.id));
      setPosts(top);
      feedCache.setPosts(feedKey, top);
    } catch (error) {
      if (posts.length === 0) setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [query, selectedCategory, dateRange, feedKey, feedCache, confirm]);

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

  useEffect(() => {
    const debounce = setTimeout(() => {
      performSearch();
    }, 300);

    return () => clearTimeout(debounce);
  }, [performSearch]);

  // ============================================================
  // ALL HOOKS ARE DONE
  // ============================================================

  const clearFilters = () => {
    setSelectedCategory(null);
    setDateRange("all");
  };

  const hasActiveFilters = selectedCategory || dateRange !== "all";

  const handleSharePost = async (post: Post) => {
    const shareUrl = `https://peja.life/post/${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Peja Alert", url: shareUrl });
      } catch (error) {}
    } else {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link copied!");
    }
  };

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header onCreateClick={() => router.push("/create")} />

      <main className="pt-16">
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
                onClick={() => setShowFilters(!showFilters)}
                className={`p-2 rounded-lg transition-colors ${
                  showFilters || hasActiveFilters
                    ? "bg-primary-600/20 text-primary-400"
                    : "hover:bg-white/10 text-dark-400"
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filters Panel */}
          {showFilters && (
            <div className="glass-card mb-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-dark-100">Filters</h3>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-sm text-primary-400"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {/* Category Filter */}
              <div>
                <label className="text-sm text-dark-400 block mb-2">Category</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.slice(0, 8).map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() =>
                        setSelectedCategory(selectedCategory === cat.id ? null : cat.id)
                      }
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        selectedCategory === cat.id
                          ? "bg-primary-600 text-white"
                          : "glass-sm text-dark-300 hover:bg-white/10"
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date Range */}
              <div>
                <label className="text-sm text-dark-400 block mb-2">Time Period</label>
                <div className="flex gap-2">
                  {[
                    { value: "today", label: "Today" },
                    { value: "week", label: "This Week" },
                    { value: "month", label: "This Month" },
                    { value: "all", label: "All Time" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setDateRange(option.value as any)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        dateRange === option.value
                          ? "bg-primary-600 text-white"
                          : "glass-sm text-dark-300 hover:bg-white/10"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Quick Search Suggestions */}
          {!query && (
            <div className="mb-4 space-y-4">
              <div>
                <p className="text-sm text-dark-400 mb-2">Popular tags</p>
                <div className="flex flex-wrap gap-2">
                  {["traffic", "robbery", "fire", "accident", "flooding"].map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setQuery(`#${tag}`)}
                      className="px-3 py-1.5 glass-sm rounded-lg text-sm text-primary-400"
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-dark-400 mb-2">Categories</p>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.slice(0, 6).map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setQuery(cat.name)}
                      className="px-3 py-1.5 glass-sm rounded-lg text-sm text-dark-300"
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-dark-400 mb-2">Popular locations</p>
                <div className="flex flex-wrap gap-2">
                  {["Lagos", "Lekki", "Victoria Island", "Ikeja", "Yaba"].map((loc) => (
                    <button
                      key={loc}
                      onClick={() => setQuery(loc)}
                      className="px-3 py-1.5 glass-sm rounded-lg text-sm text-dark-300 flex items-center gap-1"
                    >
                      <MapPin className="w-3 h-3" />
                      {loc}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Results */}
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
              {loading && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                </div>
              )}
              <p className="text-sm text-dark-400">
                {posts.length} result{posts.length !== 1 ? "s" : ""} {query && `for "${query}"`}
              </p>
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onConfirm={() => {}}
                  onShare={handleSharePost}
                  sourceKey={feedKey}
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

function SearchLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
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