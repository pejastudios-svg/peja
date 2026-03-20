"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePageCache } from "@/context/PageCacheContext";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import { InlineVideo } from "@/components/reels/InlineVideo";
import HudShell from "@/components/dashboard/HudShell";
import HudPanel from "@/components/dashboard/HudPanel";
import GlowButton from "@/components/dashboard/GlowButton";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { VideoLightbox } from "@/components/ui/VideoLightbox";
import { FlaggedContentListener } from "@/components/notifications/FlaggedContentListener";
import { apiUrl } from "@/lib/api";
import {
  Flag,
  Loader2,
  Eye,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  User,
  MessageCircle,
  RefreshCw,
  Shield,
  Clock,
  History,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type FlagRow = {
  id: string;
  post_id: string | null;
  comment_id: string | null;
  reason: string;
  source: string | null;
  priority: string | null;
  status: string | null;
  created_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  post?: {
    id: string;
    user_id: string;
    category: string;
    comment: string | null;
    address: string | null;
    is_sensitive: boolean;
    created_at: string;
    status: string;
  };
  flaggedComment?: {
    id: string;
    user_id: string;
    content: string;
    created_at: string;
    post_id: string;
  };
  media?: { url: string; media_type: string; is_sensitive: boolean }[];
  user?: { full_name: string | null; email: string | null; avatar_url: string | null };
  reviewer?: { full_name: string | null; avatar_url: string | null; is_guardian: boolean; is_admin: boolean };
  contentType: "post" | "comment";
};

function FlaggedRowSkeleton() {
  return (
    <div className="glass-card">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-xl shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-40 mb-2" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-6 w-6 rounded-lg" />
      </div>
    </div>
  );
}

export default function AdminFlaggedPage() {
  useScrollRestore("admin:flagged");
  const router = useRouter();
  const sp = useSearchParams();
  const openId = sp.get("open");

  // View mode
  const [viewMode, setViewMode] = useState<"queue" | "history">("queue");

  // Queue state
const pageCache = usePageCache();
  const cachedQueue = pageCache.get<FlagRow[]>("admin:flagged:queue");
  const cachedHistory = pageCache.get<FlagRow[]>("admin:flagged:history");

  const [items, setItems] = useState<FlagRow[]>(cachedQueue || []);
  const [loading, setLoading] = useState(cachedQueue === null);
  const [refreshing, setRefreshing] = useState(false);

  // History state
  const [historyItems, setHistoryItems] = useState<FlagRow[]>(cachedHistory || []);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Review modal state
  const [selected, setSelected] = useState<FlagRow | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [videoLightboxOpen, setVideoLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ============================================================
  // FETCH QUEUE (pending + escalated)
  // ============================================================
  const fetchFlagged = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    try {
      const { data: flags, error } = await supabase
        .from("flagged_content")
        .select("id,post_id,comment_id,reason,source,priority,status,created_at,reviewed_by,reviewed_at")
        .in("status", ["pending", "escalated"])
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const rows = (flags || []) as any[];
      const merged = await enrichFlaggedRows(rows);
      setItems(merged);
      pageCache.set("admin:flagged:queue", merged);

      if (openId) {
        const match = merged.find((x) => x.id === openId);
        if (match) {
          setSelected(match);
          setMediaIndex(0);
          setShowModal(true);
        }
      }
    } catch (e) {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [openId]);

  // ============================================================
  // FETCH HISTORY (resolved items for audit trail)
  // ============================================================
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);

    try {
      const { data: flags, error } = await supabase
        .from("flagged_content")
        .select("id,post_id,comment_id,reason,source,priority,status,created_at,reviewed_by,reviewed_at")
        .in("status", ["approved", "removed", "blurred"])
        .order("reviewed_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const rows = (flags || []) as any[];
      const merged = await enrichFlaggedRows(rows, true);
      setHistoryItems(merged);
      pageCache.set("admin:flagged:history", merged);
    } catch (e) {
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // ============================================================
  // SHARED: Enrich flagged rows with post/comment/user/media data
  // ============================================================
  const enrichFlaggedRows = async (rows: any[], includeReviewer = false): Promise<FlagRow[]> => {
    if (rows.length === 0) return [];

    const postIds = Array.from(new Set(rows.map((x: any) => x.post_id).filter(Boolean)));
    const commentIds = Array.from(new Set(rows.map((x: any) => x.comment_id).filter(Boolean)));

    // Fetch comments
    const { data: commentsData } = commentIds.length
      ? await supabase.from("post_comments").select("id,user_id,content,created_at,post_id").in("id", commentIds)
      : { data: [] };

    const commentsMap: Record<string, any> = {};
    (commentsData || []).forEach((c: any) => (commentsMap[c.id] = c));

    const commentPostIds = Array.from(new Set((commentsData || []).map((c: any) => c.post_id).filter(Boolean)));
    const allPostIds = Array.from(new Set([...postIds, ...commentPostIds]));

    // Fetch posts
    const { data: allPostsData } = allPostIds.length
      ? await supabase.from("posts").select("id,user_id,category,comment,address,is_sensitive,created_at,status").in("id", allPostIds)
      : { data: [] };

    const allPostsMap: Record<string, any> = {};
    (allPostsData || []).forEach((p: any) => (allPostsMap[p.id] = p));

    // Fetch media
    const { data: mediaData } = postIds.length
      ? await supabase.from("post_media").select("post_id,url,media_type,is_sensitive").in("post_id", postIds)
      : { data: [] };

    const mediaMap: Record<string, any[]> = {};
    (mediaData || []).forEach((m: any) => {
      if (!mediaMap[m.post_id]) mediaMap[m.post_id] = [];
      mediaMap[m.post_id].push(m);
    });

    // Fetch content owner users
    const postUserIds = (allPostsData || []).map((p: any) => p.user_id).filter(Boolean);
    const commentUserIds = (commentsData || []).map((c: any) => c.user_id).filter(Boolean);
    const allUserIds = Array.from(new Set([...postUserIds, ...commentUserIds]));

    const { data: usersData } = allUserIds.length
      ? await supabase.from("users").select("id,full_name,email,avatar_url").in("id", allUserIds)
      : { data: [] };

    const usersMap: Record<string, any> = {};
    (usersData || []).forEach((u: any) => (usersMap[u.id] = u));

    // Fetch reviewer users (for history/audit trail)
    let reviewersMap: Record<string, any> = {};
    if (includeReviewer) {
      const reviewerIds = Array.from(new Set(rows.map((r: any) => r.reviewed_by).filter(Boolean)));
      if (reviewerIds.length > 0) {
        const { data: reviewersData } = await supabase
          .from("users")
          .select("id,full_name,avatar_url,is_guardian,is_admin")
          .in("id", reviewerIds);

        (reviewersData || []).forEach((u: any) => (reviewersMap[u.id] = u));
      }
    }

    return rows.map((f: any) => {
      const isComment = !!f.comment_id;
      const comment = f.comment_id ? commentsMap[f.comment_id] : null;
      const post = f.post_id ? allPostsMap[f.post_id] : comment ? allPostsMap[comment.post_id] : null;
      const contentOwner = isComment ? (comment ? usersMap[comment.user_id] : null) : post ? usersMap[post.user_id] : null;
      const reviewer = f.reviewed_by ? reviewersMap[f.reviewed_by] : null;

      return {
        ...f,
        contentType: isComment ? "comment" : "post",
        post: post || undefined,
        flaggedComment: comment || undefined,
        media: post ? mediaMap[post.id] || [] : [],
        user: contentOwner || undefined,
        reviewer: reviewer || undefined,
      };
    });
  };

  // Initial fetch
useEffect(() => {
    if (cachedQueue) {
      fetchFlagged(true); // revalidate in background
    } else {
      fetchFlagged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch history when tab changes
useEffect(() => {
    if (viewMode === "history") {
      if (historyItems.length === 0 && !cachedHistory) {
        fetchHistory();
      } else {
        fetchHistory(); // silent revalidate since we already have data
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const handleRefresh = () => {
    if (viewMode === "queue") fetchFlagged(true);
    else fetchHistory();
  };

  // ============================================================
  // REVIEW ACTION
  // ============================================================
const handleReviewAction = async (action: "approve" | "blur" | "remove") => {
    if (!selected) return;

    const selectedItem = selected;
    
    // Optimistic: remove from queue immediately
    setItems((prev) => prev.filter((x) => x.id !== selectedItem.id));
    pageCache.set("admin:flagged:queue", items.filter((x) => x.id !== selectedItem.id));
    setShowModal(false);
    setSelected(null);

    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired");

      const res = await fetch(apiUrl("/api/admin/review-flagged"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ flaggedId: selectedItem.id, action }),
      });

      const json = await res.json();

      if (res.status === 409) {
        // Already reviewed, our optimistic removal was correct
        return;
      }

      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");

      // Notify other pages
      if (action === "remove" && selectedItem.post_id) {
        window.dispatchEvent(new CustomEvent("peja-post-archived", {
          detail: { postId: selectedItem.post_id }
        }));
      }

      // Refresh history if loaded
      if (historyItems.length > 0) {
        fetchHistory();
      }
    } catch (e: any) {
      // Revert on failure
      setItems((prev) => [...prev, selectedItem]);
      alert(e?.message || "Failed to review. Item restored to queue.");
    }
  };

  const priorityColor = (p?: string | null) => {
    switch (p) {
      case "critical": return "bg-red-500/20 text-red-400";
      case "high": return "bg-orange-500/20 text-orange-400";
      case "medium": return "bg-yellow-500/20 text-yellow-400";
      default: return "bg-green-500/20 text-green-400";
    }
  };

  const statusBadge = (status: string | null) => {
    switch (status) {
      case "approved": return "bg-green-500/20 text-green-400";
      case "removed": return "bg-red-500/20 text-red-400";
      case "blurred": return "bg-yellow-500/20 text-yellow-400";
      default: return "bg-dark-700 text-dark-400";
    }
  };

  const statusLabel = (status: string | null) => {
    switch (status) {
      case "approved": return "Approved";
      case "removed": return "Removed";
      case "blurred": return "Blurred";
      default: return status || "Unknown";
    }
  };

  const reviewerRole = (reviewer?: FlagRow["reviewer"]) => {
    if (!reviewer) return "";
    if (reviewer.is_admin) return "Admin";
    if (reviewer.is_guardian) return "Guardian";
    return "Moderator";
  };

  return (
    <HudShell
      title="Moderation Queue"
      subtitle="Review flagged content and maintain community safety"
      right={
        <GlowButton onClick={handleRefresh} disabled={refreshing || historyLoading} className="h-9 text-xs flex items-center justify-center gap-2">
          <RefreshCw className={`w-4 h-4 ${(refreshing || historyLoading) ? "animate-spin" : ""}`} />
          Refresh
        </GlowButton>
      }
    >
      <FlaggedContentListener onNewFlaggedContent={() => fetchFlagged(true)} />

      {/* Tab Toggle */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setViewMode("queue")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            viewMode === "queue"
              ? "bg-primary-600 text-white shadow-lg shadow-primary-900/30"
              : "glass-sm text-dark-300 hover:bg-white/10"
          }`}
        >
          <Flag className="w-4 h-4" />
          Queue
          {items.length > 0 && (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
              {items.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setViewMode("history")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            viewMode === "history"
              ? "bg-primary-600 text-white shadow-lg shadow-primary-900/30"
              : "glass-sm text-dark-300 hover:bg-white/10"
          }`}
        >
          <History className="w-4 h-4" />
          History
        </button>
      </div>

      {/* ============================================================ */}
      {/* QUEUE VIEW */}
      {/* ============================================================ */}
      {viewMode === "queue" && (
        <div className="space-y-3">
          {loading && items.length === 0 ? (
            Array.from({ length: 8 }).map((_, i) => <FlaggedRowSkeleton key={i} />)
          ) : items.length === 0 ? (
            <HudPanel className="text-center py-20">
              <div className="flex flex-col items-center justify-center w-full">
                <CheckCircle className="w-16 h-16 text-green-500/20 mb-4" />
                <p className="text-dark-300 font-bold text-lg">Queue Clear</p>
                <p className="text-dark-500">No flagged content pending review.</p>
              </div>
            </HudPanel>
          ) : (
            <>
              {refreshing && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                </div>
              )}
              {items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => { setSelected(item); setMediaIndex(0); setShowModal(true); }}
                  className="hud-panel p-4 cursor-pointer hover:border-primary-500/30 transition-all flex items-start gap-4 group relative overflow-hidden"
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                    item.status === "escalated" ? "bg-orange-500" :
                    item.priority === "critical" ? "bg-red-500" :
                    item.priority === "high" ? "bg-orange-500" :
                    "bg-yellow-500/50"
                  }`} />

                  <div className="w-14 h-14 rounded-lg bg-dark-900 overflow-hidden shrink-0 border border-white/5">
                    {item.contentType === "comment" ? (
                      <div className="w-full h-full flex items-center justify-center bg-dark-800">
                        <MessageCircle className="w-6 h-6 text-orange-400" />
                      </div>
                    ) : item.media?.[0] ? (
                      <img src={item.media[0].url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-dark-800">
                        <Flag className="w-6 h-6 text-dark-500" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shadow-sm ${
                        item.contentType === "comment" ? "bg-orange-500/20 text-orange-400" : priorityColor(item.priority)
                      }`}>
                        {item.contentType === "comment" ? "Comment" : (item.priority || "Low") + " Priority"}
                      </span>
                      {item.status === "escalated" && (
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 shadow-sm flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Escalated
                        </span>
                      )}
                      <span className="text-xs text-dark-500">
                        {item.created_at && formatDistanceToNow(new Date(item.created_at))} ago
                      </span>
                    </div>

                    <p className="text-sm font-bold text-dark-100 mb-1.5 line-clamp-1">
                      {item.contentType === "comment" ? (item.flaggedComment?.content || "Comment") : item.reason}
                    </p>

                    {item.contentType === "comment" && (
                      <p className="text-xs text-dark-500 mb-1.5 line-clamp-1">Reason: {item.reason}</p>
                    )}

                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-dark-800 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                        {item.user?.avatar_url ? (
                          <img src={item.user.avatar_url} className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-3 h-3 text-dark-400" />
                        )}
                      </div>
                      <p className="text-xs text-dark-400 truncate">{item.user?.full_name || "Unknown"}</p>
                    </div>
                  </div>

                  <div className="pr-2 self-center">
                    <span className="pill pill-purple opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_0_15px_rgba(124,58,237,0.4)]">Review</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* HISTORY VIEW (Audit Trail) */}
      {/* ============================================================ */}
      {viewMode === "history" && (
        <div className="space-y-3">
          {historyLoading && historyItems.length === 0 ? (
            Array.from({ length: 8 }).map((_, i) => <FlaggedRowSkeleton key={i} />)
          ) : historyItems.length === 0 ? (
            <HudPanel className="text-center py-20">
              <div className="flex flex-col items-center justify-center w-full">
                <History className="w-16 h-16 text-dark-600 mb-4" />
                <p className="text-dark-300 font-bold text-lg">No Review History</p>
                <p className="text-dark-500">Resolved items will appear here.</p>
              </div>
            </HudPanel>
          ) : (
            <>
              {historyLoading && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                </div>
              )}

              {/* Summary bar */}
              <div className="flex gap-3 mb-2">
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-sm text-dark-300">
                    {historyItems.filter(i => i.status === "approved").length} Approved
                  </span>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-sm text-dark-300">
                    {historyItems.filter(i => i.status === "removed").length} Removed
                  </span>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 flex items-center gap-2">
                  <Eye className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm text-dark-300">
                    {historyItems.filter(i => i.status === "blurred").length} Blurred
                  </span>
                </div>
              </div>

              {historyItems.map((item) => (
                <div
                  key={item.id}
                  className="hud-panel p-4 relative overflow-hidden"
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                    item.status === "approved" ? "bg-green-500" :
                    item.status === "removed" ? "bg-red-500" :
                    "bg-yellow-500"
                  }`} />

                  <div className="flex items-start gap-4">
                    {/* Thumbnail */}
                    <div className="w-12 h-12 rounded-lg bg-dark-900 overflow-hidden shrink-0 border border-white/5">
                      {item.contentType === "comment" ? (
                        <div className="w-full h-full flex items-center justify-center bg-dark-800">
                          <MessageCircle className="w-5 h-5 text-dark-500" />
                        </div>
                      ) : item.media?.[0] ? (
                        <img src={item.media[0].url} className="w-full h-full object-cover opacity-60" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-dark-800">
                          <Flag className="w-5 h-5 text-dark-600" />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {/* Status badge */}
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${statusBadge(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                        {/* Content type */}
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          item.contentType === "comment" ? "bg-orange-500/10 text-orange-400/70" : "bg-dark-700 text-dark-400"
                        }`}>
                          {item.contentType}
                        </span>
                      </div>

                      {/* Preview */}
                      <p className="text-sm text-dark-200 line-clamp-1 mb-1">
                        {item.contentType === "comment"
                          ? (item.flaggedComment?.content || "Comment")
                          : (item.post?.comment || item.reason)
                        }
                      </p>

                      {/* Reason */}
                      <p className="text-xs text-dark-500 mb-2 line-clamp-1">
                        Reason: {item.reason}
                      </p>

                      {/* Reviewer info */}
                      <div className="flex items-center gap-3 pt-2 border-t border-white/5">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-dark-800 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                            {item.reviewer?.avatar_url ? (
                              <img src={item.reviewer.avatar_url} className="w-full h-full object-cover" />
                            ) : (
                              <Shield className="w-3 h-3 text-primary-400" />
                            )}
                          </div>
                          <span className="text-xs text-dark-300">
                            {item.reviewer?.full_name || "Unknown"}
                          </span>
                          <span className="text-[10px] text-dark-500 px-1.5 py-0.5 rounded bg-dark-800">
                            {reviewerRole(item.reviewer)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 text-xs text-dark-500 ml-auto">
                          <Clock className="w-3 h-3" />
                          {item.reviewed_at
                            ? formatDistanceToNow(new Date(item.reviewed_at), { addSuffix: true })
                            : "Unknown"
                          }
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* REVIEW MODAL */}
      {/* ============================================================ */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={selected?.contentType === "comment" ? "Review Comment" : "Review Content"} size="xl">
        {selected && (
          <div className="space-y-6">
            {selected.contentType === "post" && selected.media?.[mediaIndex] && (
              <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                {selected.media[mediaIndex].media_type === "video" ? (
                  <InlineVideo
                    src={selected.media[mediaIndex].url}
                    className="w-full h-full object-contain"
                    showExpand={true}
                    showMute={true}
                    onExpand={() => { setLightboxUrl(selected.media![mediaIndex].url); setVideoLightboxOpen(true); }}
                  />
                ) : (
                  <img
                    src={selected.media[mediaIndex].url}
                    className="w-full h-full object-contain cursor-pointer"
                    onClick={() => { setLightboxUrl(selected.media![mediaIndex].url); setLightboxOpen(true); }}
                  />
                )}
                {selected.media.length > 1 && (
                  <>
                    <button onClick={() => setMediaIndex((i) => Math.max(0, i - 1))} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full hover:bg-black/80">
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button onClick={() => setMediaIndex((i) => Math.min(selected.media!.length - 1, i + 1))} className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full hover:bg-black/80">
                      <ChevronRight className="w-6 h-6" />
                    </button>
                  </>
                )}
              </div>
            )}

            {selected.contentType === "comment" && (
              <div className="p-4 bg-red-500/10 rounded-xl border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.15)]">
                <div className="flex items-center gap-2 mb-2">
                  <MessageCircle className="w-4 h-4 text-red-400" />
                  <span className="text-xs font-bold text-red-400 uppercase">Flagged Comment</span>
                </div>
                <p className="text-sm text-dark-100 wrap-break-word whitespace-pre-wrap">{selected.flaggedComment?.content || "No content."}</p>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-red-500/20">
                  <div className="w-6 h-6 rounded-full bg-dark-800 border border-white/10 overflow-hidden flex items-center justify-center">
                    {selected.user?.avatar_url ? <img src={selected.user.avatar_url} className="w-full h-full object-cover" /> : <User className="w-3 h-3 text-dark-400" />}
                  </div>
                  <span className="text-xs text-dark-400">{selected.user?.full_name || "Unknown"}</span>
                </div>
              </div>
            )}

            <div className="p-4 bg-white/5 rounded-xl border border-white/5">
              <p className="text-sm text-dark-300 wrap-break-word whitespace-pre-wrap overflow-hidden">
                <span className="text-dark-500 uppercase text-xs font-bold mr-2">Reason:</span>
                {selected.reason}
              </p>
            </div>

            {selected.contentType === "comment" && selected.post && (
              <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                <p className="text-xs text-dark-500 uppercase font-bold mb-2">On Post:</p>
                <p className="text-sm text-dark-300 wrap-break-word whitespace-pre-wrap overflow-hidden line-clamp-3">
                  {selected.post.comment || `[${selected.post.category}]`}
                </p>
              </div>
            )}

            {selected.contentType === "post" && (
              <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                <p className="text-sm text-dark-300 wrap-break-word whitespace-pre-wrap overflow-hidden">
                  <span className="text-dark-500 uppercase text-xs font-bold mr-2">Post Content:</span>
                  {selected.post?.comment || "No text content."}
                </p>
              </div>
            )}

            <div className={`grid gap-3 border-t border-white/10 pt-4 ${selected.contentType === "post" ? "grid-cols-3" : "grid-cols-2"}`}>
              <Button variant="primary" className="bg-green-600 hover:bg-green-500 border-none shadow-lg shadow-green-900/20" onClick={() => handleReviewAction("approve")} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                Safe
              </Button>
              {selected.contentType === "post" && (
                <Button variant="secondary" onClick={() => handleReviewAction("blur")} disabled={actionLoading}>
                  <Eye className="w-4 h-4 mr-2" /> Blur
                </Button>
              )}
              <Button variant="danger" onClick={() => handleReviewAction("remove")} disabled={actionLoading}>
                <XCircle className="w-4 h-4 mr-2" /> Remove
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