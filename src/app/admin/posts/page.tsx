"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/types";
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
  
  const pageSize = 20;

  useEffect(() => {
    fetchPosts();
  }, [page, statusFilter, categoryFilter]);

  const fetchPosts = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("posts")
        .select(`
          *,
          users:user_id (full_name, email),
          post_media (url, media_type)
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (categoryFilter !== "all") {
        query = query.eq("category", categoryFilter);
      }

      const { data, count, error } = await query;

      if (error) throw error;

      setPosts(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error("Error fetching posts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      fetchPosts();
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("posts")
        .select(`
          *,
          users:user_id (full_name, email),
          post_media (url, media_type)
        `)
        .or(`comment.ilike.%${searchQuery}%,address.ilike.%${searchQuery}%`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setPosts(data || []);
    } catch (error) {
      console.error("Search error:", error);
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
      await supabase.from("posts").update({ status: newStatus }).eq("id", postId);

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
      <div className="flex flex-col lg:flex-row gap-3 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search by content or location..."
            className="w-full pl-10 pr-4 py-2.5 glass-input"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-4 py-2.5 glass-input"
        >
          <option value="all">All Status</option>
          <option value="live">Live</option>
          <option value="resolved">Resolved</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          className="px-4 py-2.5 glass-input"
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
        <Button variant="primary" onClick={handleSearch}>
          Search
        </Button>
      </div>

      {/* Posts Grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <div className="glass-card text-center py-12">
          <FileText className="w-12 h-12 text-dark-600 mx-auto mb-4" />
          <p className="text-dark-400">No posts found</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {posts.map((post) => {
            const category = getCategoryInfo(post.category);
            
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
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    post.status === "live" ? "bg-green-500/20 text-green-400" :
                    post.status === "resolved" ? "bg-blue-500/20 text-blue-400" :
                    "bg-dark-600 text-dark-400"
                  }`}>
                    {post.status}
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
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-dark-400">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 glass-sm rounded-lg disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4 text-dark-400" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 glass-sm rounded-lg disabled:opacity-50"
            >
              <ChevronRight className="w-4 h-4 text-dark-400" />
            </button>
          </div>
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
                  <video
                    src={selectedPost.post_media[currentMediaIndex].url}
                    controls
                    className="w-full h-full object-contain"
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
                <p className="text-dark-200">{selectedPost.comment}</p>
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