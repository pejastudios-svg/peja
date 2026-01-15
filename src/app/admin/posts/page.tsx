"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/types";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import { InlineVideo } from "@/components/reels/InlineVideo";
import {
  Search,
  FileText,
  Eye,
  Trash2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Clock,
  CheckCircle,
  MessageCircle,
  Play,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface PostData {
  id: string;
  user_id: string;
  category: string;
  comment: string;
  address: string;
  status: string;
  confirmations: number;
  views: number;
  comment_count: number;
  report_count: number;
  is_sensitive: boolean;
  created_at: string;
  users?: { full_name: string; email: string };
  post_media?: { url: string; media_type: string }[];
}

export default function AdminPostsPage() {
  useScrollRestore("admin:posts");
  const [posts, setPosts] = useState<PostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedPost, setSelectedPost] = useState<PostData | null>(null);
  const [showPostModal, setShowPostModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const isSearchMode = searchQuery.trim().length > 0;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageSize = 20;

  useEffect(() => {
  if (isSearchMode) {
    handleSearch(); // keep search results updated when filters change
  } else {
    fetchPosts();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [page, statusFilter, categoryFilter, searchQuery]);

useEffect(() => {
  let t: any = null;

  const refresh = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      const q = searchQuery.trim();
      if (q) handleSearch();
      else fetchPosts();
    }, 600);
  };

  const ch = supabase
    .channel("admin-posts-rt")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, refresh)
    .subscribe();

  return () => {
    if (t) clearTimeout(t);
    supabase.removeChannel(ch);
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [searchQuery, statusFilter, categoryFilter, page]);

function AdminPostCardSkeleton() {
  return (
    <div className="glass-card">
      <Skeleton className="aspect-video w-full rounded-xl mb-3" />
      <Skeleton className="h-4 w-28 mb-2" />
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-3 w-3/4 mb-3" />
      <div className="flex justify-between">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

const fetchPosts = async () => {
  setLoading(true);

  try {
    // 1) fetch posts (no embeds)
    let query = supabase
      .from("posts")
      .select(
        "id,user_id,category,comment,address,status,confirmations,views,comment_count,report_count,is_sensitive,created_at",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (categoryFilter !== "all") query = query.eq("category", categoryFilter);

    const { data: postsData, count, error } = await query;

    if (error) {
      console.error("Admin posts fetch error:", error);
      setPosts([]);
      setTotalCount(0);
      return;
    }

    const rows = (postsData || []) as any[];
    const postIds = rows.map((p) => p.id);
    const userIds = Array.from(new Set(rows.map((p) => p.user_id).filter(Boolean)));
    const isSearchMode = searchQuery.trim().length > 0;

    // 2) fetch users for those posts
    const { data: usersData, error: usersErr } = userIds.length
      ? await supabase.from("users").select("id,full_name,email").in("id", userIds)
      : { data: [], error: null };

    if (usersErr) console.error("Admin posts users fetch error:", usersErr);

    const usersMap: Record<string, { full_name: string; email: string }> = {};
    (usersData || []).forEach((u: any) => {
      usersMap[u.id] = { full_name: u.full_name, email: u.email };
    });

    // 3) fetch media thumbnails for those posts
    const { data: mediaData, error: mediaErr } = postIds.length
      ? await supabase.from("post_media").select("post_id,url,media_type").in("post_id", postIds)
      : { data: [], error: null };

    if (mediaErr) console.error("Admin posts media fetch error:", mediaErr);

    const mediaMap: Record<string, { url: string; media_type: string }[]> = {};
    (mediaData || []).forEach((m: any) => {
      if (!mediaMap[m.post_id]) mediaMap[m.post_id] = [];
      mediaMap[m.post_id].push({ url: m.url, media_type: m.media_type });
    });

    // 4) merge
    const merged = rows.map((p) => ({
      ...p,
      users: usersMap[p.user_id] || undefined,
      post_media: mediaMap[p.id] || [],
    }));

    setPosts(merged);
    setTotalCount(count || 0);
  } catch (e) {
    console.error("Admin posts exception:", e);
    setPosts([]);
    setTotalCount(0);
  } finally {
    setLoading(false);
  }
};
  
 const handleSearch = async () => {
  const q = searchQuery.trim();
  if (!q) {
    fetchPosts();
    return;
  }

  setLoading(true);

  try {
    const like = `%${q}%`;

    // 1) Find matching users (name/email/phone)
    const { data: userHits, error: userErr } = await supabase
      .from("users")
      .select("id")
      .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
      .limit(25);

    if (userErr) console.error("Admin post search users error:", userErr);

    const matchedUserIds = (userHits || []).map((u: any) => u.id);

    // Helper to apply filters consistently
    const applyFilters = (qb: any) => {
      if (statusFilter !== "all") qb = qb.eq("status", statusFilter);
      if (categoryFilter !== "all") qb = qb.eq("category", categoryFilter);
      return qb;
    };

    // 2) Posts matching comment/address
    const textQuery = applyFilters(
      supabase
        .from("posts")
        .select(
          "id,user_id,category,comment,address,status,confirmations,views,comment_count,report_count,is_sensitive,created_at"
        )
        .or(`comment.ilike.${like},address.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(50)
    );

    // 3) Posts by matching users
    const userPostsQuery =
      matchedUserIds.length > 0
        ? applyFilters(
            supabase
              .from("posts")
              .select(
                "id,user_id,category,comment,address,status,confirmations,views,comment_count,report_count,is_sensitive,created_at"
              )
              .in("user_id", matchedUserIds)
              .order("created_at", { ascending: false })
              .limit(50)
          )
        : null;

    const [{ data: textPosts, error: textErr }, userPostsRes] = await Promise.all([
      textQuery,
      userPostsQuery ? userPostsQuery : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (textErr) throw textErr;
    if (userPostsRes?.error) throw userPostsRes.error;

    // 4) Merge unique posts
    const map = new Map<string, any>();
    (textPosts || []).forEach((p: any) => map.set(p.id, p));
    (userPostsRes?.data || []).forEach((p: any) => map.set(p.id, p));
    const rows = Array.from(map.values());

    const postIds = rows.map((p) => p.id);
    const userIds = Array.from(new Set(rows.map((p) => p.user_id).filter(Boolean)));

    // 5) Fetch users for display
    const { data: usersData } = userIds.length
      ? await supabase.from("users").select("id,full_name,email").in("id", userIds)
      : { data: [] };

    const usersMap: Record<string, { full_name: string; email: string }> = {};
    (usersData || []).forEach((u: any) => {
      usersMap[u.id] = { full_name: u.full_name, email: u.email };
    });

    // 6) Fetch media for display
    const { data: mediaData } = postIds.length
      ? await supabase.from("post_media").select("post_id,url,media_type").in("post_id", postIds)
      : { data: [] };

    const mediaMap: Record<string, { url: string; media_type: string }[]> = {};
    (mediaData || []).forEach((m: any) => {
      if (!mediaMap[m.post_id]) mediaMap[m.post_id] = [];
      mediaMap[m.post_id].push({ url: m.url, media_type: m.media_type });
    });

    // 7) Final merge
    const merged = rows.map((p) => ({
      ...p,
      users: usersMap[p.user_id] || undefined,
      post_media: mediaMap[p.id] || [],
    }));

    setPosts(merged);
    setTotalCount(merged.length);
    // Don’t mess with page here; search is a “mode”
  } catch (error) {
    console.error("Admin post search error:", error);
    setPosts([]);
    setTotalCount(0);
  } finally {
    setLoading(false);
  }
};

  const handleDeletePost = async (postId: string) => {
    if (!confirm("Are you sure you want to delete this post? This action cannot be undone.")) {
      return;
    }

    setActionLoading(true);
    try {
      // Delete related data first
      await supabase.from("post_comments").delete().eq("post_id", postId);
      await supabase.from("post_media").delete().eq("post_id", postId);
      await supabase.from("post_tags").delete().eq("post_id", postId);
      await supabase.from("post_confirmations").delete().eq("post_id", postId);
      await supabase.from("post_reports").delete().eq("post_id", postId);
      await supabase.from("flagged_content").delete().eq("post_id", postId);
      
      // Delete the post
      await supabase.from("posts").delete().eq("id", postId);

      // Log action
      await supabase.from("admin_logs").insert({
        admin_id: (await supabase.auth.getUser()).data.user?.id,
        action: "Deleted post",
        target_type: "post",
        target_id: postId,
      });

      setPosts(posts.filter(p => p.id !== postId));
      setShowPostModal(false);
      setSelectedPost(null);
    } catch (error) {
      console.error("Error deleting post:", error);
      alert("Failed to delete post");
    } finally {
      setActionLoading(false);
    }
  };

  const handleStatusChange = async (postId: string, newStatus: string) => {
    setActionLoading(true);
    try {
      const patch: any = { status: newStatus };

// ✅ IMPORTANT: If you set an old post back to "live", reset the clock.
// Otherwise /api/jobs/expire will flip it back to "resolved" within minutes.
if (newStatus === "live") {
  patch.created_at = new Date().toISOString();
}

await supabase.from("posts").update(patch).eq("id", postId);

      await supabase.from("admin_logs").insert({
        admin_id: (await supabase.auth.getUser()).data.user?.id,
        action: `Changed post status to ${newStatus}`,
        target_type: "post",
        target_id: postId,
      });

      setPosts(posts.map(p => p.id === postId ? { ...p, status: newStatus } : p));
      if (selectedPost?.id === postId) {
        setSelectedPost({ ...selectedPost, status: newStatus });
      }
    } catch (error) {
      console.error("Error updating status:", error);
      alert("Failed to update status");
    } finally {
      setActionLoading(false);
    }
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  const getCategoryInfo = (categoryId: string) => {
    return CATEGORIES.find(c => c.id === categoryId);
  };


  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark-100">Post Management</h1>
        <p className="text-dark-400 mt-1">View and manage all incident reports</p>
      </div>
{/* Filters */}
<div className="flex flex-col lg:flex-row gap-3 mb-6 items-stretch">
  {/* Search */}
  <div className="relative flex-1 min-w-[280px]">
    <button
      type="button"
      onClick={() => searchInputRef.current?.focus()}
      className="absolute left-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10 z-10"
      aria-label="Focus search"
    >
      <Search className="w-5 h-5 text-dark-400" />
    </button>

    <input
      ref={searchInputRef}
      type="text"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
      placeholder="Search by content or location..."
      className="glass-input w-full h-11 pl-12 pr-4"
    />
  </div>

  {/* Status */}
  <select
    value={statusFilter}
    onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
    className="glass-input w-full lg:w-44 h-11 px-4 py-0"
  >
    <option value="all">All Status</option>
    <option value="live">Live</option>
    <option value="resolved">Resolved</option>
    <option value="archived">Archived</option>
  </select>

  {/* Category */}
  <select
    value={categoryFilter}
    onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
    className="glass-input w-full lg:w-56 h-11 px-4 py-0"
  >
    <option value="all">All Categories</option>
    {CATEGORIES.map(cat => (
      <option key={cat.id} value={cat.id}>{cat.name}</option>
    ))}
  </select>

  {/* Button */}
  <Button
    variant="primary"
    onClick={handleSearch}
    className="w-full lg:w-28 h-11"
  >
    Search
  </Button>
</div>

{/* Posts Grid */}
{loading && posts.length === 0 ? (
  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
    {Array.from({ length: 9 }).map((_, i) => (
      <AdminPostCardSkeleton key={i} />
    ))}
  </div>
) : posts.length === 0 ? (
  <div className="glass-card text-center py-12">
    <FileText className="w-12 h-12 text-dark-600 mx-auto mb-4" />
    <p className="text-dark-400">No posts found</p>
  </div>
) : (
  <>
    {/* small "refreshing" spinner ONLY if we already have posts */}
    {loading && (
      <div className="flex justify-center py-2">
        <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
      </div>
    )}

    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {posts.map((post) => {
        const category = getCategoryInfo(post.category);

        const ageMs = Date.now() - new Date(post.created_at).getTime();
        const expired = ageMs >= 24 * 60 * 60 * 1000;

        const effectiveStatus =
          post.status === "archived"
            ? "archived"
            : post.status === "resolved"
            ? "resolved"
            : post.status === "live" && expired
            ? "resolved"
            : "live";

        const statusClass =
          effectiveStatus === "live"
            ? "bg-green-500/20 text-green-400"
            : effectiveStatus === "resolved"
            ? "bg-dark-600 text-dark-300"
            : "bg-dark-800 text-dark-400";
            
            return (
              <div
            key={post.id}
            onClick={() => { setSelectedPost(post); setShowPostModal(true); setCurrentMediaIndex(0); }}
            className="glass-card cursor-pointer hover:bg-white/5 transition-colors"
          >
                {/* Thumbnail */}
                <div className="aspect-video rounded-lg bg-dark-800 mb-3 overflow-hidden">
                  {post.post_media?.[0] ? (
                    post.post_media[0].media_type === "video" ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Play className="w-10 h-10 text-dark-400" />
                      </div>
                    ) : (
                      <img
                        src={post.post_media[0].url}
                        alt=""
                        className={`w-full h-full object-cover ${post.is_sensitive ? "blur-lg" : ""}`}
                      />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileText className="w-10 h-10 text-dark-600" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${statusClass}`}>
                  {effectiveStatus}
                   </span>
                  <span className="text-xs text-dark-500 capitalize">
                    {category?.name || post.category}
                  </span>
                </div>

                <p className="text-dark-200 text-sm line-clamp-2 mb-2">
                  {post.comment || "No description"}
                </p>

                <div className="flex items-center justify-between text-xs text-dark-500">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    <span className="truncate max-w-[100px]">{post.address || "Unknown"}</span>
                  </span>
                  <span>{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</span>
                </div>

                <div className="flex items-center gap-4 mt-2 pt-2 border-t border-white/5 text-xs text-dark-500">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> {post.confirmations}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageCircle className="w-3 h-3" /> {post.comment_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3" /> {post.views}
                  </span>
                </div>
              </div>
        );
      })}
    </div>
  </>
)}

      {/* Pagination */}
      {!isSearchMode && totalPages > 1 && (
  <div className="flex items-center justify-between mt-6">
    ...
  </div>
)}

      {/* Post Detail Modal */}
      <Modal
        isOpen={showPostModal}
        onClose={() => { setShowPostModal(false); setSelectedPost(null); }}
        title="Post Details"
        size="xl"
      >
        {selectedPost && (
          <div className="space-y-4">
            {/* Media */}
            {selectedPost.post_media && selectedPost.post_media.length > 0 && (
              <div className="relative aspect-video bg-dark-800 rounded-xl overflow-hidden">
                {selectedPost.post_media[currentMediaIndex].media_type === "video" ? (
  <InlineVideo
    src={selectedPost.post_media[currentMediaIndex].url}
    className="w-full h-full object-contain"
    showExpand={false}
    showMute={true}
  />
) : (
  <img
    src={selectedPost.post_media[currentMediaIndex].url}
    alt=""
    className="w-full h-full object-contain"
  />
)}
                {selectedPost.post_media.length > 1 && (
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                    {selectedPost.post_media.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentMediaIndex(i)}
                        className={`w-2 h-2 rounded-full ${i === currentMediaIndex ? "bg-white" : "bg-white/40"}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Post Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-dark-500">Category</p>
                <p className="text-dark-200 capitalize">{getCategoryInfo(selectedPost.category)?.name}</p>
              </div>
              <div>
                <p className="text-xs text-dark-500">Status</p>
                <p className="text-dark-200 capitalize">{selectedPost.status}</p>
              </div>
              <div>
                <p className="text-xs text-dark-500">Location</p>
                <p className="text-dark-200">{selectedPost.address || "Unknown"}</p>
              </div>
              <div>
                <p className="text-xs text-dark-500">Posted by</p>
                <p className="text-dark-200">{selectedPost.users?.full_name || "Anonymous"}</p>
                {selectedPost.users?.email && (
                  <p className="text-xs text-dark-500">{selectedPost.users.email}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-dark-500">Reports</p>
                <p className={`${selectedPost.report_count > 0 ? "text-red-400" : "text-dark-200"}`}>
                  {selectedPost.report_count || 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-dark-500">Posted</p>
                <p className="text-dark-200">
                  {formatDistanceToNow(new Date(selectedPost.created_at), { addSuffix: true })}
                </p>
              </div>
            </div>

            {selectedPost.comment && (
              <div>
                <p className="text-xs text-dark-500 mb-1">Description</p>
                <p className="text-dark-200 break-words whitespace-pre-wrap">
                {selectedPost.comment}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="border-t border-white/10 pt-4 flex flex-wrap gap-2">
              {selectedPost.status !== "live" && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleStatusChange(selectedPost.id, "live")}
                  disabled={actionLoading}
                >
                  Set Live
                </Button>
              )}
              {selectedPost.status !== "archived" && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleStatusChange(selectedPost.id, "archived")}
                  disabled={actionLoading}
                >
                  Archive
                </Button>
              )}
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleDeletePost(selectedPost.id)}
                disabled={actionLoading}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}