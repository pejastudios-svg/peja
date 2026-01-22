"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import { InlineVideo } from "@/components/reels/InlineVideo";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { VideoLightbox } from "@/components/ui/VideoLightbox";
import {
  Flag,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Play,
  Search,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { CATEGORIES } from "@/lib/types";

interface PostData {
  id: string;
  category: string;
  comment: string;
  address: string;
  is_sensitive: boolean;
  post_media?: { url: string; media_type: string }[];
  users?: { full_name: string };
}

interface FlaggedItem {
  id: string;
  post_id: string;
  reason: string;
  priority: string;
  status: string;
  created_at: string;
  post?: PostData;
}

export default function GuardianQueuePage() {
  function QueueRowSkeleton() {
    return (
      <div className="glass-card">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-lg shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-40 mb-2" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      </div>
    );
  }

  useScrollRestore("guardian:queue");
  const sp = useSearchParams();
  const reviewId = sp.get("review");
  const { user } = useAuth();
  
  const [items, setItems] = useState<FlaggedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<FlaggedItem | null>(null);
  
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  
  // Lightbox State
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [videoLightboxOpen, setVideoLightboxOpen] = useState(false);

  const [priorityFilter, setPriorityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const visibleItems = items.filter((item) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;

    const haystack = [
      item.reason,
      item.priority,
      item.post?.category,
      item.post?.comment,
      item.post?.address,
      item.post?.users?.full_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(q);
  });

  const openReview = (item: FlaggedItem) => {
    setSelectedItem(item);
    setCurrentMediaIndex(0);
    setShowReviewModal(true);
  };

  useEffect(() => {
    fetchQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityFilter]);

  useEffect(() => {
    let t: any = null;
    const refresh = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => fetchQueue(), 400);
    };

    const ch = supabase
      .channel("guardian-queue-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "flagged_content" }, refresh)
      .subscribe();

    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityFilter]);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("flagged_content")
        .select("id,post_id,reason,priority,status,created_at")
        .eq("status", "pending")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });

      if (priorityFilter !== "all") query = query.eq("priority", priorityFilter);

      const { data: flagged, error } = await query.limit(50);

      if (error) {
        console.error("Guardian queue fetch error:", error);
        setItems([]);
        return;
      }

      const flaggedRows = (flagged || []) as any[];
      const postIds = Array.from(new Set(flaggedRows.map((f) => f.post_id).filter(Boolean)));

      const { data: postsData, error: postsErr } = postIds.length
        ? await supabase
            .from("posts")
            .select("id,user_id,category,comment,address,is_sensitive")
            .in("id", postIds)
        : { data: [], error: null };

      if (postsErr) console.error("Guardian queue posts fetch error:", postsErr);

      const postsMap: Record<string, any> = {};
      (postsData || []).forEach((p: any) => (postsMap[p.id] = p));

      const { data: mediaData, error: mediaErr } = postIds.length
        ? await supabase.from("post_media").select("post_id,url,media_type").in("post_id", postIds)
        : { data: [], error: null };

      if (mediaErr) console.error("Guardian queue media fetch error:", mediaErr);

      const mediaMap: Record<string, { url: string; media_type: string }[]> = {};
      (mediaData || []).forEach((m: any) => {
        if (!mediaMap[m.post_id]) mediaMap[m.post_id] = [];
        mediaMap[m.post_id].push({ url: m.url, media_type: m.media_type });
      });

      const userIds = Array.from(
        new Set((postsData || []).map((p: any) => p.user_id).filter(Boolean))
      );

      const { data: usersData, error: usersErr } = userIds.length
        ? await supabase.from("users").select("id,full_name").in("id", userIds)
        : { data: [], error: null };

      if (usersErr) console.error("Guardian queue users fetch error:", usersErr);

      const usersMap: Record<string, { full_name: string }> = {};
      (usersData || []).forEach((u: any) => (usersMap[u.id] = { full_name: u.full_name }));

      const formattedItems: FlaggedItem[] = flaggedRows.map((f) => {
        const p = postsMap[f.post_id];
        return {
          id: f.id,
          post_id: f.post_id,
          reason: f.reason,
          priority: f.priority,
          status: f.status,
          created_at: f.created_at,
          post: p
            ? {
                id: p.id,
                category: p.category,
                comment: p.comment,
                address: p.address,
                is_sensitive: p.is_sensitive,
                post_media: mediaMap[p.id] || [],
                users: usersMap[p.user_id] || undefined,
              }
            : undefined,
        };
      });

      setItems(formattedItems);
      if (reviewId) {
        const match = formattedItems.find((x) => x.id === reviewId);
        if (match) openReview(match);
      }
    } catch (e) {
      console.error("Guardian queue exception:", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: "approve" | "remove" | "blur" | "escalate") => {
    if (!selectedItem || !user) return;

    setActionLoading(true);
    try {
      const newStatus = action === "escalate" ? "escalated" : action === "approve" ? "approved" : "removed";
      
      await supabase
        .from("flagged_content")
        .update({ 
          status: newStatus, 
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", selectedItem.id);

      if (action === "remove" && selectedItem.post_id) {
        await supabase
          .from("posts")
          .update({ status: "archived" })
          .eq("id", selectedItem.post_id);
      }

      if (action === "blur" && selectedItem.post_id) {
        await supabase.from("posts").update({ is_sensitive: true }).eq("id", selectedItem.post_id);
        await supabase.from("post_media").update({ is_sensitive: true }).eq("post_id", selectedItem.post_id);
      }

      try {
        await supabase.from("guardian_actions").insert({
          guardian_id: user.id,
          action,
          post_id: selectedItem.post_id,
          reason: selectedItem.reason,
        });
      } catch (e) {
        console.log("Guardian actions table may not exist yet");
      }

      setItems(items.filter(i => i.id !== selectedItem.id));
      setShowReviewModal(false);
      setSelectedItem(null);

    } catch (error) {
      console.error("Action error:", error);
      alert("Failed to complete action");
    } finally {
      setActionLoading(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical": return "bg-red-500/20 text-red-400";
      case "high": return "bg-orange-500/20 text-orange-400";
      case "medium": return "bg-yellow-500/20 text-yellow-400";
      default: return "bg-green-500/20 text-green-400";
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark-100">Review Queue</h1>
        <p className="text-dark-400 mt-1">Flagged content waiting for review</p>
      </div>
      
      <div className="mb-4">
        <div className="relative">
          <button
            type="button"
            onClick={() => searchRef.current?.focus()}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10"
            aria-label="Focus search"
          >
            <Search className="w-5 h-5 text-dark-400" />
          </button>

          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search flagged content..."
            className="w-full pl-10 pr-4 py-2.5 glass-input"
          />
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {["all", "critical", "high", "medium", "low"].map((priority) => (
          <button
            key={priority}
            onClick={() => setPriorityFilter(priority)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
              priorityFilter === priority
                ? "bg-primary-600 text-white"
                : "glass-sm text-dark-300 hover:bg-white/10"
            }`}
          >
            {priority.charAt(0).toUpperCase() + priority.slice(1)}
          </button>
        ))}
      </div>

      {/* Queue List */}
      {loading && items.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <QueueRowSkeleton key={i} />
          ))}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="glass-card text-center py-12">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark-100 mb-2">Queue is Empty!</h3>
          <p className="text-dark-400">No flagged content to review right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {loading && (
            <div className="flex justify-center py-2">
              <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
            </div>
          )}
          {visibleItems.map((item) => {
            const category = CATEGORIES.find(c => c.id === item.post?.category);
            return (
              <div
                key={item.id}
                className="glass-card hover:bg-white/5 transition-colors cursor-pointer"
                onClick={() => openReview(item)}
              >
                <div className="flex items-center gap-4">
                  {/* Thumbnail */}
                  <div className="w-16 h-16 rounded-lg bg-dark-800 shrink-0 overflow-hidden">
                    {item.post?.post_media?.[0] ? (
                      item.post.post_media[0].media_type === "video" ? (
                        <div className="w-full h-full flex items-center justify-center bg-dark-700">
                          <Play className="w-6 h-6 text-dark-400" />
                        </div>
                      ) : (
                        <img
                          src={item.post.post_media[0].url}
                          alt=""
                          className={`w-full h-full object-cover ${item.post.is_sensitive ? "blur-lg" : ""}`}
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Flag className="w-6 h-6 text-dark-500" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${getPriorityColor(item.priority)}`}>
                        {item.priority}
                      </span>
                      <span className="text-xs text-dark-500">
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="font-medium text-dark-100 truncate capitalize">
                      {category?.name || item.post?.category || "Unknown"}
                    </p>
                    <p className="text-sm text-dark-400 truncate">{item.reason}</p>
                  </div>

                  {/* Action */}
                  <button className="p-2 hover:bg-white/10 rounded-lg shrink-0">
                    <Eye className="w-5 h-5 text-primary-400" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Review Modal */}
      <Modal
        isOpen={showReviewModal}
        onClose={() => { setShowReviewModal(false); setSelectedItem(null); }}
        title="Review Content"
        size="xl"
      >
        {selectedItem?.post && (
          <div className="space-y-4">
            {/* Priority & Reason */}
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-sm ${getPriorityColor(selectedItem.priority)}`}>
                {selectedItem.priority} priority
              </span>
              <span className="text-dark-400">|</span>
              <span className="text-dark-300">{selectedItem.reason}</span>
            </div>

            {/* Media */}
            {selectedItem.post.post_media && selectedItem.post.post_media.length > 0 && (
              <div className="relative aspect-video bg-dark-800 rounded-xl overflow-hidden">
                {selectedItem.post.post_media[currentMediaIndex].media_type === "video" ? (
                  <InlineVideo
                    src={selectedItem.post.post_media[currentMediaIndex].url}
                    className="w-full h-full object-contain"
                    showExpand={true}
                    showMute={true}
                    onExpand={() => {
                        setLightboxUrl(selectedItem.post!.post_media![currentMediaIndex].url);
                        setVideoLightboxOpen(true);
                    }}
                  />
                ) : (
                  <img
                    src={selectedItem.post.post_media[currentMediaIndex].url}
                    alt=""
                    className="w-full h-full object-contain cursor-pointer"
                    onClick={() => {
                        setLightboxUrl(selectedItem.post!.post_media![currentMediaIndex].url);
                        setLightboxOpen(true);
                    }}
                  />
                )}

                {selectedItem.post.post_media.length > 1 && (
                  <>
                    <button
                      onClick={() => setCurrentMediaIndex(i => i === 0 ? selectedItem.post!.post_media!.length - 1 : i - 1)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full"
                    >
                      <ChevronLeft className="w-5 h-5 text-white" />
                    </button>
                    <button
                      onClick={() => setCurrentMediaIndex(i => i === selectedItem.post!.post_media!.length - 1 ? 0 : i + 1)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full"
                    >
                      <ChevronRight className="w-5 h-5 text-white" />
                    </button>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                      {selectedItem.post.post_media.map((_, i) => (
                        <div
                          key={i}
                          className={`w-2 h-2 rounded-full ${i === currentMediaIndex ? "bg-white" : "bg-white/40"}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Post Info */}
            <div className="p-4 bg-white/5 rounded-xl space-y-2">
              <p className="text-sm text-dark-400">
                Category: <span className="text-dark-200 capitalize">{selectedItem.post.category?.replace(/_/g, " ")}</span>
              </p>
              {selectedItem.post.comment && (
                <p className="text-dark-200">{selectedItem.post.comment}</p>
              )}
              {selectedItem.post.address && (
                <p className="text-sm text-dark-400">Location: {selectedItem.post.address}</p>
              )}
              <p className="text-sm text-dark-500">
                Posted by: {selectedItem.post.users?.full_name || "Anonymous"}
              </p>
            </div>

            {/* Actions */}
            <div className="border-t border-white/10 pt-4">
              <p className="text-sm text-dark-400 mb-3">Take Action:</p>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="primary"
                  onClick={() => handleAction("approve")}
                  disabled={actionLoading}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleAction("blur")}
                  disabled={actionLoading}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Add Blur
                </Button>
                <Button
                  variant="danger"
                  onClick={() => handleAction("remove")}
                  disabled={actionLoading}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Remove
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleAction("escalate")}
                  disabled={actionLoading}
                >
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Escalate
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ImageLightbox 
        isOpen={lightboxOpen} 
        onClose={() => setLightboxOpen(false)} 
        imageUrl={lightboxUrl} 
      />
      <VideoLightbox 
        isOpen={videoLightboxOpen} 
        onClose={() => setVideoLightboxOpen(false)} 
        videoUrl={lightboxUrl} 
      />
    </div>
  );
}