"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
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

  const [items, setItems] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected] = useState<FlagRow | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [videoLightboxOpen, setVideoLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

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

      // Fetch related data...
      const postIds = Array.from(new Set(rows.map((x) => x.post_id).filter(Boolean)));
      const commentIds = Array.from(new Set(rows.map((x) => x.comment_id).filter(Boolean)));

      const { data: commentsData } = commentIds.length
        ? await supabase.from("post_comments").select("id,user_id,content,created_at,post_id").in("id", commentIds)
        : { data: [] };

      const commentsMap: Record<string, any> = {};
      (commentsData || []).forEach((c: any) => (commentsMap[c.id] = c));

      const commentPostIds = Array.from(new Set((commentsData || []).map((c: any) => c.post_id).filter(Boolean)));
      const allPostIds = Array.from(new Set([...postIds, ...commentPostIds]));

      const { data: allPostsData } = allPostIds.length
        ? await supabase.from("posts").select("id,user_id,category,comment,address,is_sensitive,created_at,status").in("id", allPostIds)
        : { data: [] };

      const allPostsMap: Record<string, any> = {};
      (allPostsData || []).forEach((p: any) => (allPostsMap[p.id] = p));

      const { data: mediaData } = postIds.length
        ? await supabase.from("post_media").select("post_id,url,media_type,is_sensitive").in("post_id", postIds)
        : { data: [] };

      const mediaMap: Record<string, any[]> = {};
      (mediaData || []).forEach((m: any) => {
        if (!mediaMap[m.post_id]) mediaMap[m.post_id] = [];
        mediaMap[m.post_id].push(m);
      });

      const postUserIds = (allPostsData || []).map((p: any) => p.user_id).filter(Boolean);
      const commentUserIds = (commentsData || []).map((c: any) => c.user_id).filter(Boolean);
      const userIds = Array.from(new Set([...postUserIds, ...commentUserIds]));

      const { data: usersData } = userIds.length
        ? await supabase.from("users").select("id,full_name,email,avatar_url").in("id", userIds)
        : { data: [] };

      const usersMap: Record<string, any> = {};
      (usersData || []).forEach((u: any) => (usersMap[u.id] = u));

      const merged: FlagRow[] = rows.map((f: any) => {
        const isComment = !!f.comment_id;
        const comment = f.comment_id ? commentsMap[f.comment_id] : null;
        const post = f.post_id ? allPostsMap[f.post_id] : comment ? allPostsMap[comment.post_id] : null;
        const contentOwner = isComment ? (comment ? usersMap[comment.user_id] : null) : post ? usersMap[post.user_id] : null;

        return {
          ...f,
          contentType: isComment ? "comment" : "post",
          post: post || undefined,
          flaggedComment: comment || undefined,
          media: post ? mediaMap[post.id] || [] : [],
          user: contentOwner || undefined,
        };
      });

      setItems(merged);

      // Auto-open from notification link
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

  // Initial fetch
  useEffect(() => {
    fetchFlagged();
  }, [fetchFlagged]);

  const handleRefresh = () => {
    fetchFlagged(true);
  };

  const handleReviewAction = async (action: "approve" | "blur" | "remove") => {
    if (!selected) return;

    setActionLoading(true);
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
        body: JSON.stringify({ flaggedId: selected.id, action }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");

      // Optimistic update
      setItems((prev) => prev.filter((x) => x.id !== selected.id));
      // Notify other pages that a post was archived
if (action === "remove" && selected.post_id) {
  window.dispatchEvent(new CustomEvent("peja-post-archived", { 
    detail: { postId: selected.post_id } 
  }));
}
      setShowModal(false);
      setSelected(null);
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally {
      setActionLoading(false);
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

  return (
    <HudShell
      title="Moderation Queue"
      subtitle="Review flagged content and maintain community safety"
      right={
        <GlowButton onClick={handleRefresh} disabled={refreshing} className="h-9 text-xs flex items-center justify-center gap-2">
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing..." : "Refresh Queue"}
        </GlowButton>
      }
    >
      {/* Realtime listener for flagged_content changes */}
      <FlaggedContentListener onNewFlaggedContent={() => fetchFlagged(true)} />

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
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${item.priority === "critical" ? "bg-red-500" : item.priority === "high" ? "bg-orange-500" : "bg-yellow-500/50"}`} />

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
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shadow-sm ${item.contentType === "comment" ? "bg-orange-500/20 text-orange-400" : priorityColor(item.priority)}`}>
                      {item.contentType === "comment" ? "Comment" : (item.priority || "Low") + " Priority"}
                    </span>
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

            {/* Action buttons - NO ESCALATE for admin */}
            <div className={`grid gap-3 border-t border-white/10 pt-4 ${selected.contentType === "post" ? "grid-cols-3" : "grid-cols-2"}`}>
              <Button variant="primary" className="bg-green-600 hover:bg-green-500 border-none shadow-lg shadow-green-900/20" onClick={() => handleReviewAction("approve")} disabled={actionLoading}>
                <CheckCircle className="w-4 h-4 mr-2" /> Safe
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