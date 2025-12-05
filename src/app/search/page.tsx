"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES } from "@/lib/types";
import { PostCard } from "@/components/posts/PostCard";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Sidebar } from "@/components/layout/Sidebar";
import {
  Search,
  X,
  Loader2,
  SlidersHorizontal,
  MapPin,
} from "lucide-react";

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "all">("all");

  const performSearch = useCallback(async () => {
    setLoading(true);

    try {
      let queryBuilder = supabase
        .from("posts")
        .select(`
          *,
          post_media (*),
          post_tags (tag)
        `)
        .order("created_at", { ascending: false })
        .limit(50);

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

      const { data, error } = await queryBuilder;

      if (error) throw error;

      let formattedPosts: Post[] = (data || []).map((post) => ({
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
        created_at: post.created_at,
        media:
          post.post_media?.map((m: any) => ({
            id: m.id,
            post_id: m.post_id,
            url: m.url,
            media_type: m.media_type,
            is_sensitive: m.is_sensitive,
          })) || [],
        tags: post.post_tags?.map((t: any) => t.tag) || [],
      }));

      // Client-side filtering for better search
      if (query.trim()) {
        const searchTerm = query.toLowerCase().trim();
        
        // Check if searching for a tag
        if (searchTerm.startsWith("#")) {
          const tagQuery = searchTerm.slice(1);
          formattedPosts = formattedPosts.filter((p) =>
            p.tags?.some((t) => t.toLowerCase().includes(tagQuery))
          );
        } else {
          // Search in comment, address, category name, and tags
          formattedPosts = formattedPosts.filter((p) => {
            const categoryName = CATEGORIES.find((c) => c.id === p.category)?.name || "";
            
            return (
              p.comment?.toLowerCase().includes(searchTerm) ||
              p.address?.toLowerCase().includes(searchTerm) ||
              categoryName.toLowerCase().includes(searchTerm) ||
              p.category.toLowerCase().includes(searchTerm) ||
              p.tags?.some((t) => t.toLowerCase().includes(searchTerm))
            );
          });
        }
      }

      setPosts(formattedPosts);
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setLoading(false);
    }
  }, [query, selectedCategory, dateRange]);

  useEffect(() => {
    const debounce = setTimeout(() => {
      performSearch();
    }, 300);

    return () => clearTimeout(debounce);
  }, [performSearch]);

  const clearFilters = () => {
    setSelectedCategory(null);
    setDateRange("all");
  };

  const hasActiveFilters = selectedCategory || dateRange !== "all";

  const handleSharePost = async (post: Post) => {
    const shareUrl = `${window.location.origin}/post/${post.id}`;
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
      <Header
        onMenuClick={() => setSidebarOpen(true)}
        onCreateClick={() => router.push("/create")}
      />

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="pt-16 lg:pl-64">
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
              autoFocus
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
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12">
              <Search className="w-12 h-12 text-dark-600 mx-auto mb-4" />
              <p className="text-dark-400">
                {query ? `No results for "${query}"` : "Start typing to search"}
              </p>
              <p className="text-sm text-dark-500 mt-1">
                Try searching for keywords, #tags, locations, or categories
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-dark-400">
                {posts.length} result{posts.length !== 1 ? "s" : ""}{" "}
                {query && `for "${query}"`}
              </p>
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