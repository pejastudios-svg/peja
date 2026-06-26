"use client";

import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES } from "@/lib/types";
import { PostCard } from "@/components/posts/PostCard";
import { Header } from "@/components/layout/Header";
import { useFeedCache } from "@/context/FeedContext";
import { useConfirm } from "@/context/ConfirmContext";
import { realtimeManager } from "@/lib/realtime";
import {
  Search,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { PejaSpinner } from "@/components/ui/PejaSpinner";

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
  // Tag filter — freeform list, mirrors the create page's tag UX (any
  // user-typed tag; no preset list). A post matches when it carries
  // ALL of the entered tags (case-insensitive).
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const feedCache = useFeedCache();
  const feedKey = `search:q=${query}|cat=${selectedCategory ?? "all"}|range=${dateRange}|tags=${tagFilters.slice().sort().join(",")}`;

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

  // Pull from the home feed caches when the live search query fails
  // (offline / network hiccup) and the search-specific cache key is
  // empty too. The home feed is the largest already-on-device corpus
  // — using it offline means the user sees something to filter through
  // instead of "No posts yet". Online searches are untouched: this is
  // only invoked from the catch path below.
  const seedFromHomeCache = useCallback((): Post[] => {
    if (typeof window === "undefined") return [];
    const nearby = feedCache.get("home:nearby")?.posts || [];
    const trending = feedCache.get("home:trending")?.posts || [];
    const dedupe = new Map<string, Post>();
    for (const p of [...nearby, ...trending]) {
      if (p?.id && !dedupe.has(p.id)) dedupe.set(p.id, p);
    }
    let merged = Array.from(dedupe.values());

    if (selectedCategory) {
      merged = merged.filter((p) => p.category === selectedCategory);
    }
    if (dateRange !== "all") {
      const now = new Date();
      let startDate: Date;
      switch (dateRange) {
        case "today": startDate = new Date(now.setHours(0, 0, 0, 0)); break;
        case "week": startDate = new Date(now.setDate(now.getDate() - 7)); break;
        case "month": startDate = new Date(now.setMonth(now.getMonth() - 1)); break;
        default: startDate = new Date(0);
      }
      merged = merged.filter(
        (p) => new Date(p.created_at).getTime() >= startDate.getTime(),
      );
    }
    if (tagFilters.length > 0) {
      merged = merged.filter((p) => {
        const tagSet = new Set((p.tags || []).map((t) => (t || "").toLowerCase()));
        return tagFilters.every((t) => tagSet.has(t));
      });
    }
    if (query.trim()) {
      const searchTerm = query.toLowerCase().trim();
      if (searchTerm.startsWith("#")) {
        const tagQuery = searchTerm.slice(1);
        merged = merged.filter((p) =>
          (p.tags || []).some((t) => (t || "").toLowerCase().includes(tagQuery)),
        );
      } else {
        merged = merged.filter((p) => {
          const categoryName =
            CATEGORIES.find((c) => c.id === p.category)?.name || "";
          const comment = (p.comment ?? "").toLowerCase();
          const address = (p.address ?? "").toLowerCase();
          const categoryId = (p.category ?? "").toLowerCase();
          const tags = (p.tags ?? []).map((t) => (t ?? "").toLowerCase());
          return (
            comment.includes(searchTerm) ||
            address.includes(searchTerm) ||
            categoryName.toLowerCase().includes(searchTerm) ||
            categoryId.includes(searchTerm) ||
            tags.some((t) => t.includes(searchTerm))
          );
        });
      }
    }
    return feedCache.applyDeletes(merged).slice(0, 50);
  }, [feedCache, selectedCategory, dateRange, tagFilters, query]);

  const performSearch = useCallback(async () => {
    // Only show loading skeleton if we have NO cached results
    if (posts.length === 0) setLoading(true);

    // When offline, skip the network call entirely. The service worker
    // returns a synthetic `Response("[]")` for /rest/v1/posts on fetch
    // failure (see sw.js NETWORK_FIRST_PATTERNS) — supabase-js parses
    // that as a successful query with zero rows, which would mask
    // the "no network" case as "no matching posts" and prevent the
    // home-cache seed below from ever running. Bypassing supabase
    // when navigator says offline keeps this clean.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const seeded = seedFromHomeCache();
      if (seeded.length > 0) {
        confirm.hydrateCounts(
          seeded.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 })),
        );
        confirm.loadConfirmedFor(seeded.map((p) => p.id));
        setPosts(seeded);
      } else if (posts.length === 0) {
        setPosts([]);
      }
      // Don't write the seeded list under the search feedKey — the
      // user's actual query may match more rows once they're back
      // online, and we don't want a stale "[]" cached for this key.
      setLoading(false);
      return;
    }

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

      // Tag filter — post must include ALL selected tags (case-insensitive).
      // Mirrors the create page's freeform tag list: any user-typed tag is
      // valid, no preset list.
      if (tagFilters.length > 0) {
        formattedPosts = formattedPosts.filter((p) => {
          const tagSet = new Set((p.tags || []).map((t) => (t || "").toLowerCase()));
          return tagFilters.every((t) => tagSet.has(t));
        });
      }

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
      const display = feedCache.applyDeletes(top);
      confirm.hydrateCounts(display.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 })));
      confirm.loadConfirmedFor(display.map((p) => p.id));
      setPosts(display);
      feedCache.setPosts(feedKey, display);
    } catch (error) {
      // Network failed (likely offline). If we already have cached
      // results on screen, leave them alone. Otherwise, seed from the
      // home feed caches so the user has something to filter through
      // instead of an empty "No posts yet" state.
      if (posts.length === 0) {
        const seeded = seedFromHomeCache();
        if (seeded.length > 0) {
          confirm.hydrateCounts(
            seeded.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 })),
          );
          confirm.loadConfirmedFor(seeded.map((p) => p.id));
          setPosts(seeded);
        } else {
          setPosts([]);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [query, selectedCategory, dateRange, tagFilters, feedKey, feedCache, confirm, seedFromHomeCache]);

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
  }, [query, selectedCategory, dateRange, tagFilters]);

  // ============================================================
  // ALL HOOKS ARE DONE
  // ============================================================

  const clearFilters = () => {
    setSelectedCategory(null);
    setDateRange("all");
    setTagFilters([]);
    setTagInput("");
  };

  const hasActiveFilters = selectedCategory || dateRange !== "all" || tagFilters.length > 0;

  const addTagFilter = () => {
    const raw = tagInput.replace(/^#/, "").trim().toLowerCase();
    if (!raw) return;
    setTagFilters((prev) => (prev.includes(raw) ? prev : [...prev, raw]));
    setTagInput("");
  };

  const removeTagFilter = (tag: string) => {
    setTagFilters((prev) => prev.filter((t) => t !== tag));
  };

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
    <PullToRefresh onRefresh={async () => { await performSearch(); }}>
    <div className="min-h-screen pb-20 lg:pb-0">
      <Header onCreateClick={() => router.push("/create")} />

      <main className="pt-app-header-pill">
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

              {/* Category Filter — same list as the create page (kidnapping,
                  terrorist, general). "crime" and "fire" are intentionally
                  excluded; mirror the filter in create/page.tsx. */}
              <div>
                <label className="text-sm text-dark-400 block mb-2">Category</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.filter((cat) => cat.id !== "crime" && cat.id !== "fire").map((cat) => (
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

              {/* Tags — freeform input mirroring the create page's tag
                  UX. Type any tag, press Enter or Add to apply, tap × to
                  remove. Filter matches posts that have ALL the tags. */}
              <div>
                <label className="text-sm text-dark-400 block mb-2">Tags</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTagFilter();
                      }
                    }}
                    placeholder="Add tag"
                    className="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-sm bg-[var(--glass-input-bg)] border border-[var(--glass-border)] text-dark-100 placeholder-dark-500 focus:outline-none focus:border-primary-500/40"
                  />
                  <button
                    type="button"
                    onClick={addTagFilter}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-sm bg-primary-600 text-white hover:bg-primary-500 transition-colors"
                  >
                    Add
                  </button>
                </div>
                {tagFilters.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tagFilters.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                        style={{
                          background: "rgba(124, 58, 237, 0.15)",
                          border: "1px solid rgba(139, 92, 246, 0.25)",
                          color: "#c4b5fd",
                        }}
                      >
                        #{tag}
                        <button
                          type="button"
                          onClick={() => removeTagFilter(tag)}
                          aria-label={`Remove ${tag}`}
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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

{/* Results */}
          {posts.length === 0 && !loading ? (
            <div className="text-center py-12 text-dark-400">No posts yet.</div>
          ) : posts.length === 0 && loading ? (
            <div className="flex justify-center py-12">
              <PejaSpinner className="w-6 h-6" />
            </div>
          ) : (
            <div className="space-y-4">
              {loading && (
                <div className="flex justify-center py-2">
                  <PejaSpinner className="w-5 h-5" />
                </div>
              )}
              <p className="text-sm text-dark-400">
                {posts.length} result{posts.length !== 1 ? "s" : ""} {query && `for "${query}"`}
              </p>
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onShare={handleSharePost}
                  sourceKey={feedKey}
                />
              ))}
            </div>
          )}
        </div>
      </main>
</div>
    </PullToRefresh>
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