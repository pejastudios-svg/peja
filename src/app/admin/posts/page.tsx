"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { CATEGORIES } from "@/lib/types";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import { InlineVideo } from "@/components/reels/InlineVideo";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import { ChevronDown } from "lucide-react";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { VideoLightbox } from "@/components/ui/VideoLightbox";
import {
  Search,
  FileText,
  Eye,
  Trash2,
  Loader2,
  MapPin,
  CheckCircle,
  MessageCircle,
  Play,
  CheckSquare,
  Square,
  X,
  MinusSquare,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/context/ToastContext";
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
  const toast = useToast();
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
  
  // Lightboxes
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [videoLightboxOpen, setVideoLightboxOpen] = useState(false);
  // =====================================================
  // MULTI-SELECT STATE
  // =====================================================
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  // =====================================================
  // DELETE CONFIRMATION STATE (in-app toast instead of browser confirm)
  // =====================================================
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  
  const isSearchMode = searchQuery.trim().length > 0;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageSize = 20;
  // Clear selection when posts change (page change, filter change, etc.)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, statusFilter, categoryFilter]);
  useEffect(() => {
    if (isSearchMode) {
      handleSearch();
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
        console.error(error);
        setPosts([]);
        setTotalCount(0);
        return;
      }
      const rows = (postsData || []) as any[];
      const postIds = rows.map((p) => p.id);
      const userIds = Array.from(new Set(rows.map((p) => p.user_id).filter(Boolean)));
      const { data: usersData } = userIds.length
        ? await supabase.from("users").select("id,full_name,email").in("id", userIds)
        : { data: [] };
      const usersMap: Record<string, { full_name: string; email: string }> = {};
      (usersData || []).forEach((u: any) => {
        usersMap[u.id] = { full_name: u.full_name, email: u.email };
      });
      const { data: mediaData } = postIds.length
        ? await supabase.from("post_media").select("post_id,url,media_type").in("post_id", postIds)
        : { data: [] };
      const mediaMap: Record<string, { url: string; media_type: string }[]> = {};
      (mediaData || []).forEach((m: any) => {
        if (!mediaMap[m.post_id]) mediaMap[m.post_id] = [];
        mediaMap[m.post_id].push({ url: m.url, media_type: m.media_type });
      });
      const merged = rows.map((p) => ({
        ...p,
        users: usersMap[p.user_id] || undefined,
        post_media: mediaMap[p.id] || [],
      }));
      setPosts(merged);
      setTotalCount(count || 0);
    } catch (e) {
      console.error(e);
      setPosts([]);
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
      const { data: userHits } = await supabase
        .from("users")
        .select("id")
        .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
        .limit(25);
      const matchedUserIds = (userHits || []).map((u: any) => u.id);
      const applyFilters = (qb: any) => {
        if (statusFilter !== "all") qb = qb.eq("status", statusFilter);
        if (categoryFilter !== "all") qb = qb.eq("category", categoryFilter);
        return qb;
      };
      const textQuery = applyFilters(
        supabase.from("posts").select("*").or(`comment.ilike.${like},address.ilike.${like}`).order("created_at", { ascending: false }).limit(50)
      );
      const userPostsQuery = matchedUserIds.length > 0
          ? applyFilters(supabase.from("posts").select("*").in("user_id", matchedUserIds).order("created_at", { ascending: false }).limit(50))
          : null;
      const [{ data: textPosts }, userPostsRes] = await Promise.all([
        textQuery,
        userPostsQuery ? userPostsQuery : Promise.resolve({ data: [] } as any),
      ]);
      const map = new Map<string, any>();
      (textPosts || []).forEach((p: any) => map.set(p.id, p));
      (userPostsRes?.data || []).forEach((p: any) => map.set(p.id, p));
      const rows = Array.from(map.values());
      const postIds = rows.map((p) => p.id);
      const userIds = Array.from(new Set(rows.map((p) => p.user_id).filter(Boolean)));
      const { data: usersData } = userIds.length
        ? await supabase.from("users").select("id,full_name,email").in("id", userIds)
        : { data: [] };
      const usersMap: Record<string, any> = {};
      (usersData || []).forEach((u: any) => (usersMap[u.id] = { full_name: u.full_name, email: u.email }));
      const { data: mediaData } = postIds.length
        ? await supabase.from("post_media").select("post_id,url,media_type").in("post_id", postIds)
        : { data: [] };
      const mediaMap: Record<string, any[]> = {};
      (mediaData || []).forEach((m: any) => {
        if (!mediaMap[m.post_id]) mediaMap[m.post_id] = [];
        mediaMap[m.post_id].push({ url: m.url, media_type: m.media_type });
      });
      const merged = rows.map((p) => ({
        ...p,
        users: usersMap[p.user_id] || undefined,
        post_media: mediaMap[p.id] || [],
      }));
      setPosts(merged);
      setTotalCount(merged.length);
    } catch (error) {
      console.error(error);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };
  // =====================================================
  // SINGLE DELETE (with in-app confirmation)
  // =====================================================
  const handleDeletePost = async (postId: string) => {
    setActionLoading(true);
    try {
      await supabase.from("post_comments").delete().eq("post_id", postId);
      await supabase.from("post_media").delete().eq("post_id", postId);
      await supabase.from("post_tags").delete().eq("post_id", postId);
      await supabase.from("post_confirmations").delete().eq("post_id", postId);
      await supabase.from("post_reports").delete().eq("post_id", postId);
      await supabase.from("flagged_content").delete().eq("post_id", postId);
      await supabase.from("posts").delete().eq("id", postId);
      await supabase.from("admin_logs").insert({
        admin_id: (await supabase.auth.getUser()).data.user?.id,
        action: "Deleted post",
        target_type: "post",
        target_id: postId,
      });
      setPosts(prev => prev.filter(p => p.id !== postId));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
      setShowPostModal(false);
      setSelectedPost(null);
      setConfirmDeleteId(null);
      toast.success("Post deleted successfully");
    } catch (error) {
      console.error(error);
      toast.danger("Failed to delete post");
    } finally {
      setActionLoading(false);
    }
  };
  // =====================================================
  // BULK DELETE (with in-app confirmation)
  // =====================================================
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setActionLoading(true);
    let successCount = 0;
    let failCount = 0;
    try {
      const adminId = (await supabase.auth.getUser()).data.user?.id;
      for (const postId of ids) {
        try {
          await supabase.from("post_comments").delete().eq("post_id", postId);
          await supabase.from("post_media").delete().eq("post_id", postId);
          await supabase.from("post_tags").delete().eq("post_id", postId);
          await supabase.from("post_confirmations").delete().eq("post_id", postId);
          await supabase.from("post_reports").delete().eq("post_id", postId);
          await supabase.from("flagged_content").delete().eq("post_id", postId);
          await supabase.from("posts").delete().eq("id", postId);
          await supabase.from("admin_logs").insert({
            admin_id: adminId,
            action: "Deleted post (bulk)",
            target_type: "post",
            target_id: postId,
          });
          successCount++;
        } catch {
          failCount++;
        }
      }
      setPosts(prev => prev.filter(p => !selectedIds.has(p.id)));
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
      if (failCount === 0) {
        toast.success(`${successCount} post${successCount > 1 ? "s" : ""} deleted successfully`);
      } else {
        toast.warning(`${successCount} deleted, ${failCount} failed`);
      }
    } catch (error) {
      console.error(error);
      toast.danger("Bulk delete failed");
    } finally {
      setActionLoading(false);
    }
  };
  const handleStatusChange = async (postId: string, newStatus: string) => {
    setActionLoading(true);
    try {
      const patch: any = { status: newStatus };
      if (newStatus === "live") patch.created_at = new Date().toISOString();
      await supabase.from("posts").update(patch).eq("id", postId);
      
      setPosts(posts.map(p => p.id === postId ? { ...p, status: newStatus } : p));
      if (selectedPost?.id === postId) {
        setSelectedPost({ ...selectedPost, status: newStatus });
      }
      toast.success(`Post status changed to ${newStatus}`);
    } catch (error) {
      console.error(error);
      toast.danger("Failed to update status");
    } finally {
      setActionLoading(false);
    }
  };
  // =====================================================
  // SELECTION HELPERS
  // =====================================================
  const toggleSelect = useCallback((postId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }, []);
  const selectAll = useCallback(() => {
    if (selectedIds.size === posts.length) {
      // All selected → deselect all
      setSelectedIds(new Set());
    } else {
      // Select all visible posts
      setSelectedIds(new Set(posts.map(p => p.id)));
    }
  }, [posts, selectedIds.size]);
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, []);
  const isAllSelected = posts.length > 0 && selectedIds.size === posts.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < posts.length;
  // Auto-enter select mode when selections exist
  useEffect(() => {
    if (selectedIds.size > 0 && !selectMode) {
      setSelectMode(true);
    }
  }, [selectedIds.size, selectMode]);
  const totalPages = Math.ceil(totalCount / pageSize);
  const getCategoryInfo = (categoryId: string) => CATEGORIES.find(c => c.id === categoryId);
  return (
    <HudShell
      title="Post Intelligence"
      subtitle="Live feed of community incident reports"
      right={
        <div className="flex items-center gap-2">
          {/* Select Mode Toggle */}
          <button
            onClick={() => {
              if (selectMode) {
                clearSelection();
              } else {
                setSelectMode(true);
              }
            }}
            className={`text-xs font-mono px-3 py-1.5 rounded-lg transition-all ${
              selectMode
                ? "bg-primary-600/20 text-primary-400 border border-primary-500/30"
                : "bg-white/5 text-dark-400 border border-white/10 hover:bg-white/10"
            }`}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
          <div className="text-xs font-mono text-dark-400 bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg">
            {totalCount} RECORDS
          </div>
        </div>
      }
    >
      {/* Filters */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-6">
        <div className="lg:col-span-5 relative group">
          <div className="absolute inset-0 bg-primary-500/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500 z-10" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search content or location..."
            className="w-full h-11 pl-10 pr-4 bg-[#1E1B24] border border-white/10 rounded-xl text-sm text-white placeholder:text-dark-500 focus:outline-none focus:border-primary-500/50 focus:shadow-[0_0_15px_rgba(124,58,237,0.15)] transition-all relative z-0"
          />
        </div>
        <div className="lg:col-span-3 relative">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="w-full h-11 pl-4 pr-10 bg-[#1E1B24] border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-primary-500/50 appearance-none cursor-pointer transition-all hover:bg-white/5"
          >
            <option value="all" className="bg-[#1E1B24] text-white">All Status</option>
            <option value="live" className="bg-[#1E1B24] text-white">Live</option>
            <option value="resolved" className="bg-[#1E1B24] text-white">Resolved</option>
            <option value="archived" className="bg-[#1E1B24] text-white">Archived</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500 pointer-events-none" />
        </div>
        <div className="lg:col-span-3 relative">
          <select
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            className="w-full h-11 pl-4 pr-10 bg-[#1E1B24] border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-primary-500/50 appearance-none cursor-pointer transition-all hover:bg-white/5"
          >
            <option value="all" className="bg-[#1E1B24] text-white">All Categories</option>
            {CATEGORIES.map(cat => (
              <option key={cat.id} value={cat.id} className="bg-[#1E1B24] text-white">{cat.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500 pointer-events-none" />
        </div>
        <div className="lg:col-span-1">
          <Button variant="primary" onClick={handleSearch} className="w-full h-11 bg-primary-600 hover:bg-primary-500 shadow-lg border-none">
            Go
          </Button>
        </div>
      </div>
      {/* Select All Bar — visible when in select mode */}
      {selectMode && posts.length > 0 && (
        <div className="flex items-center justify-between mb-4 px-3 py-2.5 rounded-xl bg-primary-600/10 border border-primary-500/20">
          <button
            onClick={selectAll}
            className="flex items-center gap-2 text-sm font-medium text-primary-300 hover:text-primary-200 transition-colors"
          >
            {isAllSelected ? (
              <CheckSquare className="w-4.5 h-4.5 text-primary-400" />
            ) : isSomeSelected ? (
              <MinusSquare className="w-4.5 h-4.5 text-primary-400" />
            ) : (
              <Square className="w-4.5 h-4.5 text-dark-400" />
            )}
            {isAllSelected ? "Deselect All" : `Select All (${posts.length})`}
          </button>
          <span className="text-xs text-dark-400">
            {selectedIds.size} selected
          </span>
        </div>
      )}
      {loading && posts.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <AdminPostCardSkeleton key={i} />)}
        </div>
      ) : posts.length === 0 ? (
        <HudPanel className="py-20 min-h-[400px]">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-dark-800 flex items-center justify-center mb-4 border border-white/5">
               <FileText className="w-8 h-8 text-dark-600" />
            </div>
            <p className="text-dark-300 font-medium text-lg">No posts found</p>
          </div>
        </HudPanel>
      ) : (
        <>
          {loading && (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {posts.map((post) => {
              const category = getCategoryInfo(post.category);
              const ageMs = Date.now() - new Date(post.created_at).getTime();
              const expired = ageMs >= 24 * 60 * 60 * 1000;
              const effectiveStatus = post.status === "live" && expired ? "resolved" : post.status;
              const statusColor = effectiveStatus === "live" ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-dark-800 text-dark-400 border-white/10";
              const isSelected = selectedIds.has(post.id);
              return (
                <div
                  key={post.id}
                  onClick={() => {
                    if (selectMode) {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(post.id)) {
                          next.delete(post.id);
                        } else {
                          next.add(post.id);
                        }
                        return next;
                      });
                    } else {
                      setSelectedPost(post);
                      setShowPostModal(true);
                      setCurrentMediaIndex(0);
                    }
                  }}
                  className={`hud-panel p-0 relative group overflow-hidden cursor-pointer transition-all flex flex-col h-full ${
                    isSelected
                      ? "ring-2 ring-primary-500 border-primary-500/40 shadow-[0_0_20px_rgba(124,58,237,0.15)]"
                      : "hover:border-primary-500/40 hover:shadow-[0_0_30px_rgba(0,0,0,0.3)]"
                  }`}
                >
                  {/* Selection checkbox */}
                  {selectMode && (
                    <button
                      onClick={(e) => toggleSelect(post.id, e)}
                      className={`absolute top-3 right-3 z-20 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                        isSelected
                          ? "bg-primary-600 border-primary-500 shadow-[0_0_10px_rgba(124,58,237,0.4)]"
                          : "bg-black/50 border-white/20 backdrop-blur-md hover:bg-black/70"
                      } border`}
                    >
                      {isSelected ? (
                        <CheckCircle className="w-4 h-4 text-white" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-white/60" />
                      )}
                    </button>
                  )}
                  {/* Selected overlay */}
                  {isSelected && (
                    <div className="absolute inset-0 bg-primary-500/5 z-10 pointer-events-none" />
                  )}
                  <div className="aspect-video bg-dark-900 relative overflow-hidden shrink-0">
                    {post.post_media?.[0] ? (
                      post.post_media[0].media_type === "video" ? (
                        <div className="w-full h-full flex items-center justify-center bg-dark-800 group-hover:scale-105 transition-transform duration-700">
                          <Play className="w-10 h-10 text-white/80 backdrop-blur-sm p-2.5 bg-black/40 rounded-full" />
                        </div>
                      ) : (
                        <img
                          src={post.post_media[0].url}
                          alt=""
                          className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 ${post.is_sensitive ? "blur-xl scale-110" : ""}`}
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[#18151f]">
                        <FileText className="w-10 h-10 text-dark-700" />
                      </div>
                    )}
                    
                    <div className="absolute top-3 left-3 flex gap-2 z-10">
                       <span className={`px-2.5 py-1 rounded-lg text-[10px] uppercase font-bold tracking-wide border backdrop-blur-md shadow-sm ${statusColor}`}>
                          {effectiveStatus}
                       </span>
                    </div>
                  </div>
                  <div className="p-4 flex-1 flex flex-col bg-linear-to-b from-transparent to-black/20">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary-300">
                        {category?.name || post.category}
                      </span>
                      <span className="text-[10px] text-dark-500 font-medium">
                        {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm text-dark-100 line-clamp-2 mb-4 leading-relaxed font-medium flex-1">
                      {post.comment || "No description provided."}
                    </p>
                    <div className="pt-3 border-t border-white/5 flex items-center justify-between mt-auto">
                      <div className="flex items-center gap-1.5 text-xs text-dark-400 max-w-[50%]">
                        <MapPin className="w-3.5 h-3.5 text-dark-500 shrink-0" />
                        <span className="truncate">{post.address || "Unknown"}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-dark-500 font-medium">
                        <div className="flex items-center gap-1 hover:text-primary-300 transition-colors">
                           <Eye className="w-3.5 h-3.5" /> {post.views}
                        </div>
                        <div className="flex items-center gap-1 hover:text-primary-300 transition-colors">
                           <MessageCircle className="w-3.5 h-3.5" /> {post.comment_count}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {!isSearchMode && totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 px-1">
           <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
           <span className="text-sm text-dark-400">Page {page} of {totalPages}</span>
           <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}
      {/* =====================================================
          FLOATING ACTION TOOLBAR — visible when posts are selected
          ===================================================== */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]" style={{ animation: "slideUp 0.3s ease-out" }}>
          <div
            className="flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl"
            style={{
              background: "rgba(12, 8, 24, 0.95)",
              border: "1px solid rgba(139, 92, 246, 0.25)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 30px rgba(124,58,237,0.1)",
              backdropFilter: "blur(16px)",
            }}
          >
            {/* Count badge */}
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                  boxShadow: "0 0 12px rgba(124,58,237,0.4)",
                }}
              >
                {selectedIds.size}
              </div>
              <span className="text-sm text-dark-300 font-medium">selected</span>
            </div>
            {/* Divider */}
            <div className="w-px h-8 bg-white/10" />
            {/* Delete button */}
            <button
              onClick={() => setConfirmBulkDelete(true)}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "#f87171",
              }}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
            {/* Clear button */}
            <button
              onClick={clearSelection}
              className="p-2 rounded-xl hover:bg-white/10 text-dark-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {/* =====================================================
          SINGLE DELETE CONFIRMATION MODAL (in-app)
          ===================================================== */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)} />
          <div
            className="relative w-full max-w-sm rounded-2xl p-6"
            style={{
              background: "rgba(12, 8, 24, 0.98)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              boxShadow: "0 0 60px rgba(239, 68, 68, 0.08), 0 25px 60px rgba(0,0,0,0.6)",
            }}
          >
            {/* Red glow strip */}
            <div
              className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
              style={{
                background: "linear-gradient(90deg, transparent, #ef4444, transparent)",
                boxShadow: "0 0 20px rgba(239,68,68,0.5)",
              }}
            />
            <div className="flex justify-center mb-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "2px solid rgba(239, 68, 68, 0.3)",
                  boxShadow: "0 0 20px rgba(239, 68, 68, 0.15)",
                }}
              >
                <Trash2 className="w-7 h-7 text-red-400" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-white text-center mb-2">Delete Post?</h3>
            <p className="text-sm text-dark-400 text-center mb-6">
              This will permanently delete this post and all its comments, media, and reports. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-3 rounded-xl text-sm font-medium transition-all hover:bg-white/5 active:scale-[0.98]"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#94a3b8",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeletePost(confirmDeleteId)}
                disabled={actionLoading}
                className="flex-1 py-3 rounded-xl text-sm font-medium text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                  boxShadow: "0 4px 15px rgba(239,68,68,0.25)",
                }}
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* =====================================================
          BULK DELETE CONFIRMATION MODAL (in-app)
          ===================================================== */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setConfirmBulkDelete(false)} />
          <div
            className="relative w-full max-w-sm rounded-2xl p-6"
            style={{
              background: "rgba(12, 8, 24, 0.98)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              boxShadow: "0 0 60px rgba(239, 68, 68, 0.08), 0 25px 60px rgba(0,0,0,0.6)",
            }}
          >
            {/* Red glow strip */}
            <div
              className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
              style={{
                background: "linear-gradient(90deg, transparent, #ef4444, transparent)",
                boxShadow: "0 0 20px rgba(239,68,68,0.5)",
              }}
            />
            <div className="flex justify-center mb-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "2px solid rgba(239, 68, 68, 0.3)",
                  boxShadow: "0 0 20px rgba(239, 68, 68, 0.15)",
                }}
              >
                <Trash2 className="w-7 h-7 text-red-400" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-white text-center mb-2">
              Delete {selectedIds.size} Post{selectedIds.size > 1 ? "s" : ""}?
            </h3>
            <p className="text-sm text-dark-400 text-center mb-6">
              This will permanently delete {selectedIds.size} post{selectedIds.size > 1 ? "s" : ""} and all associated data. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmBulkDelete(false)}
                className="flex-1 py-3 rounded-xl text-sm font-medium transition-all hover:bg-white/5 active:scale-[0.98]"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#94a3b8",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={actionLoading}
                className="flex-1 py-3 rounded-xl text-sm font-medium text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
                  boxShadow: "0 4px 15px rgba(239,68,68,0.25)",
                }}
              >
                {actionLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete {selectedIds.size}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* =====================================================
          POST DETAIL MODAL — updated delete to use in-app confirm
          ===================================================== */}
      <Modal
        isOpen={showPostModal}
        onClose={() => { setShowPostModal(false); setSelectedPost(null); }}
        title="Post Details"
        size="xl"
      >
        {selectedPost && (
          <div className="space-y-5">
            {selectedPost.post_media && selectedPost.post_media.length > 0 && (
              <div className="relative aspect-video bg-black/50 rounded-xl overflow-hidden border border-white/10 shadow-2xl">
                {selectedPost.post_media[currentMediaIndex].media_type === "video" ? (
                  <InlineVideo
                    src={selectedPost.post_media[currentMediaIndex].url}
                    className="w-full h-full object-contain"
                    showExpand={true}
                    showMute={true}
                    onExpand={() => {
                        setLightboxUrl(selectedPost.post_media![currentMediaIndex].url);
                        setVideoLightboxOpen(true);
                    }}
                  />
                ) : (
                  <img
                    src={selectedPost.post_media[currentMediaIndex].url}
                    alt=""
                    className="w-full h-full object-contain cursor-pointer"
                    onClick={() => {
                        setLightboxUrl(selectedPost.post_media![currentMediaIndex].url);
                        setLightboxOpen(true);
                    }}
                  />
                )}
                {selectedPost.post_media.length > 1 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-black/40 backdrop-blur-md rounded-full">
                    {selectedPost.post_media.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentMediaIndex(i)}
                        className={`w-2 h-2 rounded-full transition-all ${i === currentMediaIndex ? "bg-white scale-125" : "bg-white/30 hover:bg-white/60"}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 p-5 bg-[#121016] rounded-xl border border-white/5">
              <div>
                <p className="text-[10px] text-dark-500 uppercase tracking-widest font-bold mb-1">Category</p>
                <p className="text-dark-200 capitalize font-medium">{getCategoryInfo(selectedPost.category)?.name}</p>
              </div>
              <div>
                <p className="text-[10px] text-dark-500 uppercase tracking-widest font-bold mb-1">Status</p>
                <p className="text-dark-200 capitalize font-medium">{selectedPost.status}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] text-dark-500 uppercase tracking-widest font-bold mb-1">Location</p>
                <p className="text-dark-200 font-medium flex items-center gap-2">
                   <MapPin className="w-3.5 h-3.5 text-dark-400" />
                   {selectedPost.address || "Unknown"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] text-dark-500 uppercase tracking-widest font-bold mb-1">Posted By</p>
                <div className="flex items-center gap-2">
                   <p className="text-dark-200 font-medium">{selectedPost.users?.full_name || "Anonymous"}</p>
                   {selectedPost.users?.email && <span className="text-xs text-dark-500">({selectedPost.users.email})</span>}
                </div>
              </div>
            </div>
            {selectedPost.comment && (
              <div className="p-5 bg-white/5 rounded-xl border border-white/5">
                <p className="text-[10px] text-dark-500 uppercase tracking-widest font-bold mb-2">Description</p>
                <p className="text-dark-200 wrap-break-word whitespace-pre-wrap leading-relaxed text-sm">
                  {selectedPost.comment}
                </p>
              </div>
            )}
            <div className="border-t border-white/10 pt-5 flex flex-wrap gap-3">
              {selectedPost.status !== "live" && (
                <Button variant="primary" className="bg-green-600 hover:bg-green-500 border-none shadow-lg shadow-green-900/20" onClick={() => handleStatusChange(selectedPost.id, "live")} disabled={actionLoading}>
                  <CheckCircle className="w-4 h-4 mr-2" /> Set Live
                </Button>
              )}
              {selectedPost.status !== "archived" && (
                <Button variant="secondary" onClick={() => handleStatusChange(selectedPost.id, "archived")} disabled={actionLoading}>
                  Archive
                </Button>
              )}
              <div className="flex-1" />
              <Button
                variant="danger"
                onClick={() => {
                  setShowPostModal(false);
                  setConfirmDeleteId(selectedPost.id);
                }}
                disabled={actionLoading}
              >
                <Trash2 className="w-4 h-4 mr-2" /> Delete Post
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <ImageLightbox isOpen={lightboxOpen} onClose={() => setLightboxOpen(false)} imageUrl={lightboxUrl} />
      <VideoLightbox isOpen={videoLightboxOpen} onClose={() => setVideoLightboxOpen(false)} videoUrl={lightboxUrl} />
    </HudShell>
  );
}