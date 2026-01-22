"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Flag,
  Loader2,
  Eye,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  User, // Added this
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
    <HudShell
      title="Moderation Queue"
      subtitle="Review flagged content and maintain community safety"
      right={
        <GlowButton onClick={fetchFlagged} className="h-9 text-xs">
           Refresh Queue
        </GlowButton>
      }
    >
      <div className="space-y-3">
         {loading && items.length === 0 ? (
            Array.from({ length: 8 }).map((_, i) => <FlaggedRowSkeleton key={i} />)
         ) : items.length === 0 ? (
            <HudPanel className="text-center py-20 flex flex-col items-center justify-center">
               <CheckCircle className="w-16 h-16 text-green-500/20 mb-4" />
               <p className="text-dark-300 font-bold text-lg">Queue Clear</p>
               <p className="text-dark-500">No flagged content pending review.</p>
            </HudPanel>
         ) : (
            items.map((item) => (
               <div
                  key={item.id}
                  onClick={() => { setSelected(item); setMediaIndex(0); setShowModal(true); }}
                  className="hud-panel p-4 cursor-pointer hover:border-primary-500/30 transition-all flex items-start gap-4 group relative overflow-hidden"
               >
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${item.priority === 'critical' ? 'bg-red-500' : item.priority === 'high' ? 'bg-orange-500' : 'bg-yellow-500/50'}`} />

                  <div className="w-16 h-16 rounded-xl bg-dark-900 overflow-hidden shrink-0 border border-white/5 relative">
                     {item.media?.[0] ? (
                        <img src={item.media[0].url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                     ) : (
                        <div className="w-full h-full flex items-center justify-center bg-dark-800">
                             <Flag className="w-6 h-6 text-dark-500" />
                        </div>
                     )}
                  </div>

                  <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shadow-sm ${priorityColor(item.priority)}`}>
                           {item.priority || "Low"} Priority
                        </span>
                        <span className="text-xs text-dark-500">
                           {item.created_at && formatDistanceToNow(new Date(item.created_at))} ago
                        </span>
                     </div>
                     <p className="text-sm font-bold text-dark-100 mb-1">
                        {item.reason}
                     </p>
                     <p className="text-xs text-dark-400 mt-0.5 truncate flex items-center gap-1">
                        <User className="w-3 h-3" /> {item.user?.full_name || "Unknown"}
                     </p>
                  </div>
                  
                  <div className="pr-2 self-center">
                     <span className="pill pill-purple opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_0_15px_rgba(124,58,237,0.4)]">Review</span>
                  </div>
               </div>
            ))
         )}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Review Content" size="xl">
         {selected && (
            <div className="space-y-6">
               <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                  {selected.media?.[mediaIndex] && (
                     selected.media[mediaIndex].media_type === 'video' ? (
                        <InlineVideo src={selected.media[mediaIndex].url} className="w-full h-full object-contain" />
                     ) : (
                        <img src={selected.media[mediaIndex].url} className="w-full h-full object-contain" />
                     )
                  )}
                  {/* Arrows if multiple media */}
                  {selected.media && selected.media.length > 1 && (
                      <>
                        <button onClick={() => setMediaIndex(i => Math.max(0, i-1))} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full hover:bg-black/80"><ChevronLeft className="w-6 h-6"/></button>
                        <button onClick={() => setMediaIndex(i => Math.min(selected.media!.length-1, i+1))} className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full hover:bg-black/80"><ChevronRight className="w-6 h-6"/></button>
                      </>
                  )}
               </div>
               
               <div className="p-4 bg-white/5 rounded-xl border border-white/5">
    <p className="text-sm text-dark-300 wrap-break-word whitespace-pre-wrap overflow-hidden">
       <span className="text-dark-500 uppercase text-xs font-bold mr-2">Post Content:</span> 
       {selected.post?.comment || "No text content."}
    </p>
</div>

               <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-white/10 pt-4">
                  <Button variant="primary" className="bg-green-600 hover:bg-green-500 border-none shadow-lg shadow-green-900/20" onClick={() => handleReviewAction("approve")}>
                      <CheckCircle className="w-4 h-4 mr-2" /> Safe
                  </Button>
                  <Button variant="secondary" onClick={() => handleReviewAction("blur")}>
                      <Eye className="w-4 h-4 mr-2" /> Blur
                  </Button>
                  <Button variant="danger" onClick={() => handleReviewAction("remove")}>
                      <XCircle className="w-4 h-4 mr-2" /> Remove
                  </Button>
                  <Button variant="secondary" onClick={() => handleReviewAction("escalate")}>
                      <AlertTriangle className="w-4 h-4 mr-2" /> Escalate
                  </Button>
               </div>
            </div>
         )}
    </Modal>
    </HudShell>
  );
}