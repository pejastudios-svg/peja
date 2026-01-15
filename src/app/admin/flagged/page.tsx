"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { Skeleton } from "@/components/ui/Skeleton";
import { InlineVideo } from "@/components/reels/InlineVideo";
import {
  Flag,
  Loader2,
  Eye,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type FlagRow = {
  id: string;
  post_id: string | null;
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

  media?: { url: string; media_type: string; is_sensitive: boolean }[];
  user?: { full_name: string | null; email: string | null; avatar_url: string | null };
};

export default function AdminFlaggedPage() {
  useScrollRestore("admin:flagged");
  const router = useRouter();
  const sp = useSearchParams();
  const openId = sp.get("open");

  const [items, setItems] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<FlagRow | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [mediaIndex, setMediaIndex] = useState(0);


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

  const fetchFlagged = async () => {
    setLoading(true);
    try {
      const { data: flags, error } = await supabase
        .from("flagged_content")
        .select("id,post_id,reason,source,priority,status,created_at,reviewed_by,reviewed_at")
        .in("status", ["pending", "escalated"])
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const rows = (flags || []) as any[];
      const postIds = Array.from(new Set(rows.map((x) => x.post_id).filter(Boolean)));

      // posts
      const { data: postsData } = postIds.length
        ? await supabase
            .from("posts")
            .select("id,user_id,category,comment,address,is_sensitive,created_at,status")
            .in("id", postIds)
        : { data: [] };

      const postsMap: Record<string, any> = {};
      (postsData || []).forEach((p: any) => (postsMap[p.id] = p));

      // media
      const { data: mediaData } = postIds.length
        ? await supabase
            .from("post_media")
            .select("post_id,url,media_type,is_sensitive")
            .in("post_id", postIds)
        : { data: [] };

      const mediaMap: Record<string, any[]> = {};
      (mediaData || []).forEach((m: any) => {
        if (!mediaMap[m.post_id]) mediaMap[m.post_id] = [];
        mediaMap[m.post_id].push(m);
      });

      // users (poster)
      const userIds = Array.from(
        new Set((postsData || []).map((p: any) => p.user_id).filter(Boolean))
      );

      const { data: usersData } = userIds.length
        ? await supabase.from("users").select("id,full_name,email,avatar_url").in("id", userIds)
        : { data: [] };

      const usersMap: Record<string, any> = {};
      (usersData || []).forEach((u: any) => (usersMap[u.id] = u));

      const merged: FlagRow[] = rows.map((f: any) => {
        const p = f.post_id ? postsMap[f.post_id] : null;
        return {
          ...f,
          post: p || undefined,
          media: p ? mediaMap[p.id] || [] : [],
          user: p ? usersMap[p.user_id] || undefined : undefined,
        };
      });

      setItems(merged);

      // auto-open from notification link
      if (openId) {
        const match = merged.find((x) => x.id === openId);
        if (match) {
          setSelected(match);
          setMediaIndex(0);
          setShowModal(true);
        }
      }
    } catch (e) {
      console.error("Admin flagged fetch error:", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
  fetchFlagged();

  const channel = supabase
    .channel("admin-flagged-rt")
    .on("postgres_changes", { event: "*", schema: "public", table: "flagged_content" }, () => {
      // refresh list on any flagged_content change
      fetchFlagged();
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [openId]);

  const handleReviewAction = async (action: "approve" | "blur" | "remove" | "escalate") => {
    if (!selected) return;

    setActionLoading(true);
    try {
      const { data: auth } = await supabase.auth.getSession();
      const token = auth.session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const res = await fetch("/api/admin/review-flagged", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ flaggedId: selected.id, action }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Failed");

      setShowModal(false);
      setSelected(null);
      await fetchFlagged();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Failed");
    } finally {
      setActionLoading(false);
    }
  };

  const priorityColor = (p?: string | null) => {
    switch (p) {
      case "critical":
        return "bg-red-500/20 text-red-400";
      case "high":
        return "bg-orange-500/20 text-orange-400";
      case "medium":
        return "bg-yellow-500/20 text-yellow-400";
      default:
        return "bg-green-500/20 text-green-400";
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-100 flex items-center gap-2">
            <Flag className="w-6 h-6 text-primary-400" />
            Flagged Content
          </h1>
          <p className="text-dark-400 mt-1">Posts needing review</p>
        </div>
        <Button variant="secondary" onClick={fetchFlagged}>
          Refresh
        </Button>
      </div>

      {loading && items.length === 0 ? (
  <div className="space-y-3">
    {Array.from({ length: 8 }).map((_, i) => (
      <FlaggedRowSkeleton key={i} />
    ))}
  </div>
) : items.length === 0 ? (
  <div className="glass-card text-center py-10">
    <p className="text-dark-400">No flagged items right now</p>
  </div>
) : (
  <div className="space-y-3">
    {loading && (
      <div className="flex justify-center py-2">
        <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
      </div>
    )}
    {items.map((item) => (
            <div
              key={item.id}
              onClick={() => {
                setSelected(item);
                setMediaIndex(0);
                setShowModal(true);
              }}
              className="glass-card cursor-pointer hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-dark-800 overflow-hidden shrink-0 flex items-center justify-center">
                  {item.media?.[0]?.media_type === "photo" ? (
                    <img src={item.media[0].url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Flag className="w-6 h-6 text-dark-500" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${priorityColor(item.priority)}`}>
                      {item.priority || "low"}
                    </span>
                    <span className="text-xs text-dark-500">
                      {item.created_at ? formatDistanceToNow(new Date(item.created_at), { addSuffix: true }) : ""}
                    </span>
                  </div>

                  <p className="text-sm text-dark-100 truncate">
                    {item.user?.full_name || "Unknown"} • {item.post?.category || "Unknown"}
                  </p>
                  <p className="text-xs text-dark-400 truncate">{item.reason}</p>
                </div>

                <Eye className="w-5 h-5 text-primary-400 shrink-0" />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setSelected(null);
        }}
        title="Review Flag"
        size="xl"
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-sm ${priorityColor(selected.priority)}`}>
                {selected.priority || "low"} priority
              </span>
              <span className="text-dark-400">•</span>
              <span className="text-dark-300">{selected.reason}</span>
            </div>

            {selected.media && selected.media.length > 0 && (
              <div className="relative aspect-video bg-dark-900 rounded-xl overflow-hidden">
                {selected.media[mediaIndex].media_type === "video" ? (
  <InlineVideo
    src={selected.media[mediaIndex].url}
    className="w-full h-full object-contain"
    showExpand={false}
    showMute={true}
  />
) : (
  <img src={selected.media[mediaIndex].url} alt="" className="w-full h-full object-contain" />
)}

                {selected.media.length > 1 && (
                  <>
                    <button
                      onClick={() => setMediaIndex((i) => (i === 0 ? selected.media!.length - 1 : i - 1))}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full"
                    >
                      <ChevronLeft className="w-5 h-5 text-white" />
                    </button>
                    <button
                      onClick={() => setMediaIndex((i) => (i === selected.media!.length - 1 ? 0 : i + 1))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full"
                    >
                      <ChevronRight className="w-5 h-5 text-white" />
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="glass-sm rounded-xl p-4 space-y-2">
              <p className="text-sm text-dark-200">
                Posted by: <span className="text-dark-100">{selected.user?.full_name || "Unknown"}</span>
              </p>
              {selected.user?.email && <p className="text-xs text-dark-500">{selected.user.email}</p>}
              {selected.post?.address && <p className="text-sm text-dark-300">Location: {selected.post.address}</p>}
              {selected.post?.comment && <p className="text-sm text-dark-200 whitespace-pre-wrap">{selected.post.comment}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
              <Button
                variant="primary"
                className="bg-green-600 hover:bg-green-700"
                disabled={actionLoading}
                onClick={() => handleReviewAction("approve")}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Approve
              </Button>

              <Button variant="secondary" disabled={actionLoading} onClick={() => handleReviewAction("blur")}>
                <Eye className="w-4 h-4 mr-2" />
                Add Blur
              </Button>

              <Button variant="danger" disabled={actionLoading} onClick={() => handleReviewAction("remove")}>
                <XCircle className="w-4 h-4 mr-2" />
                Remove
              </Button>

              <Button variant="secondary" disabled={actionLoading} onClick={() => handleReviewAction("escalate")}>
                <AlertTriangle className="w-4 h-4 mr-2" />
                Escalate
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}