"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { notifyPostConfirmed } from "@/lib/notifications";
import { CheckCircle, MessageCircle, Share2, Eye, X, Loader2 } from "lucide-react";
import { ReelVideo } from "@/components/reels/ReelVideo";

export default function WatchClient({
  startId,
  source,
}: {
  startId: string | null;
  source: string | null;
}) {
  const router = useRouter();
  const { user } = useAuth();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePostId, setActivePostId] = useState<string | null>(null);

  const [confirmedSet, setConfirmedSet] = useState<Set<string>>(new Set());
  const confirmingRef = useRef<Set<string>>(new Set());

  // Track viewed posts in this session
  const viewedRef = useRef<Set<string>>(new Set());

  // Keep latest posts accessible inside callbacks
  const postsRef = useRef<Post[]>([]);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  // Load posts (you can later change ordering depending on "source")
  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("posts")
        .select(`
          id, user_id, category, comment, address, latitude, longitude,
          is_anonymous, status, is_sensitive,
          confirmations, views, comment_count, report_count, created_at,
          post_media (id, post_id, url, media_type, is_sensitive)
        `)
        .eq("status", "live")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error(error);
        setPosts([]);
        setLoading(false);
        return;
      }

      const formatted: Post[] = (data || []).map((p: any) => ({
        id: p.id,
        user_id: p.user_id,
        category: p.category,
        comment: p.comment,
        location: { latitude: p.latitude ?? 0, longitude: p.longitude ?? 0 },
        address: p.address,
        is_anonymous: p.is_anonymous,
        status: p.status,
        is_sensitive: p.is_sensitive,
        confirmations: p.confirmations || 0,
        views: p.views || 0,
        comment_count: p.comment_count || 0,
        report_count: p.report_count || 0,
        created_at: p.created_at,
        media: (p.post_media || []).map((m: any) => ({
          id: m.id,
          post_id: m.post_id,
          url: m.url,
          media_type: m.media_type,
          is_sensitive: m.is_sensitive,
        })),
        tags: [],
      }));

      setPosts(formatted);
      setLoading(false);
    };

    load();
  }, [source]);

  // Load which posts are confirmed by the current user
  useEffect(() => {
    const loadConfirmed = async () => {
      if (!user) return;
      if (posts.length === 0) return;

      const ids = posts.map((p) => p.id);

      const { data, error } = await supabase
        .from("post_confirmations")
        .select("post_id")
        .eq("user_id", user.id)
        .in("post_id", ids);

      if (error) {
        console.error(error);
        return;
      }

      const s = new Set<string>();
      (data || []).forEach((r: any) => s.add(r.post_id));
      setConfirmedSet(s);
    };

    loadConfirmed();
  }, [user, posts]);

  const ordered = useMemo(() => {
    if (!startId) return posts;
    const idx = posts.findIndex((p) => p.id === startId);
    if (idx <= 0) return posts;
    return [posts[idx], ...posts.slice(0, idx), ...posts.slice(idx + 1)];
  }, [posts, startId]);

  const handleShare = async (postId: string) => {
    const url = `${window.location.origin}/post/${postId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Peja Alert", url });
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(url);
    // optional: replace with toast later
    alert("Link copied!");
  };

  const toggleConfirm = async (post: Post) => {
    if (!user) {
      router.push("/login");
      return;
    }

    if (confirmingRef.current.has(post.id)) return;
    confirmingRef.current.add(post.id);

    const wasConfirmed = confirmedSet.has(post.id);
    const prevCount = post.confirmations || 0;

    // optimistic UI
    setConfirmedSet((prev) => {
      const next = new Set(prev);
      if (wasConfirmed) next.delete(post.id);
      else next.add(post.id);
      return next;
    });

    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, confirmations: wasConfirmed ? Math.max(0, prevCount - 1) : prevCount + 1 }
          : p
      )
    );

    try {
      if (wasConfirmed) {
        await supabase
          .from("post_confirmations")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", user.id);

        await supabase
          .from("posts")
          .update({ confirmations: Math.max(0, prevCount - 1) })
          .eq("id", post.id);
      } else {
        const { error } = await supabase
          .from("post_confirmations")
          .insert({ post_id: post.id, user_id: user.id });

        // If duplicate, rollback optimistic change
        if (error && error.code === "23505") {
          setConfirmedSet((prev) => {
            const next = new Set(prev);
            next.add(post.id);
            return next;
          });
          setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, confirmations: prevCount } : p)));
          return;
        }
        if (error) throw error;

        await supabase.from("posts").update({ confirmations: prevCount + 1 }).eq("id", post.id);

        // notify post owner
        if (post.user_id && post.user_id !== user.id) {
          notifyPostConfirmed(post.id, post.user_id, user.full_name || "Someone").catch(() => {});
        }
      }
    } catch (e) {
      console.error(e);

      // rollback
      setConfirmedSet((prev) => {
        const next = new Set(prev);
        if (wasConfirmed) next.add(post.id);
        else next.delete(post.id);
        return next;
      });
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, confirmations: prevCount } : p)));
    } finally {
      confirmingRef.current.delete(post.id);
    }
  };

  // Increment views when a post is in view (60% visible)
  const markViewed = async (postId: string) => {
    if (viewedRef.current.has(postId)) return;
    viewedRef.current.add(postId);

    const current = postsRef.current.find((p) => p.id === postId);
    if (!current) return;

    // optimistic local update
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, views: (p.views || 0) + 1 } : p)));

    // best-effort DB update (no .catch; await works)
    try {
      await supabase
        .from("posts")
        .update({ views: (current.views || 0) + 1 })
        .eq("id", postId);
    } catch {
      // ignore
    }
  };

  // Observe which slide is active
useEffect(() => {
  if (typeof window === "undefined") return;

  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-postid]"));
  if (els.length === 0) return;

  const obs = new IntersectionObserver(
    (entries) => {
      // choose the entry with highest intersection ratio
      let best: { id: string; ratio: number } | null = null;

      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.postid;
        if (!id) continue;
        if (!entry.isIntersecting) continue;

        const ratio = entry.intersectionRatio;
        if (!best || ratio > best.ratio) best = { id, ratio };
      }

      if (best && best.ratio >= 0.6) {
        setActivePostId(best.id);
      }
    },
    { threshold: [0.6, 0.75, 0.9] }
  );

  els.forEach((el) => obs.observe(el));
  return () => obs.disconnect();
}, [ordered.length]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <Loader2 className="w-7 h-7 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-[9999]">
      <button
        onClick={() => router.back()}
        className="fixed top-4 right-4 z-50 p-2 rounded-full bg-black/60"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      >
        <X className="w-6 h-6 text-white" />
      </button>

      <div className="h-full w-full overflow-y-scroll" style={{ scrollSnapType: "y mandatory" }}>
        {ordered.map((post) => {
          const media = post.media?.[0];
          const isVideo = media?.media_type === "video";
          const isConfirmed = confirmedSet.has(post.id);

          return (
            <div
              key={post.id}
              data-postid={post.id}
              className="h-screen w-full flex items-center justify-center relative"
              style={{ scrollSnapAlign: "start" }}
            >
              {isVideo ? (
             <ReelVideo
             src={media?.url || ""}
              active={activePostId === post.id}
              onWatched2s={() => {
              // your existing markViewed logic can be reused here
              markViewed(post.id);
              }}
               />
              ) : (
                 <img src={media?.url || ""} className="h-full w-full object-contain" alt="" />
              )}

              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
                <p className="text-white text-sm break-words whitespace-pre-wrap line-clamp-3">
                  {post.comment || ""}
                </p>

                <div className="mt-3 flex items-center justify-between text-white/90 text-sm pointer-events-auto">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => toggleConfirm(post)}
                      className={`flex items-center gap-1 ${isConfirmed ? "text-primary-300" : ""}`}
                    >
                      <CheckCircle className={`w-5 h-5 ${isConfirmed ? "fill-current" : ""}`} />
                      {post.confirmations || 0}
                    </button>

                    <button onClick={() => router.push(`/post/${post.id}`)} className="flex items-center gap-1">
                      <MessageCircle className="w-5 h-5" />
                      {post.comment_count || 0}
                    </button>

                    <span className="flex items-center gap-1">
                      <Eye className="w-5 h-5" />
                      {post.views || 0}
                    </span>
                  </div>

                  <button onClick={() => handleShare(post.id)} className="p-2 rounded-full bg-white/10">
                    <Share2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}