"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { notifyPostConfirmed } from "@/lib/notifications";
import { ReelVideo } from "@/components/reels/ReelVideo";
import { CheckCircle, MessageCircle, Share2, Eye, X, Loader2 } from "lucide-react";
import { useFeedCache } from "@/context/FeedContext";
import { useConfirm } from "@/context/ConfirmContext";
import { useAudio } from "@/context/AudioContext";
import { Skeleton } from "@/components/ui/Skeleton";

const SEEN_KEY = "peja-seen-posts-v1";
type SeenStore = Record<string, number>;

function readSeenStore(): SeenStore {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const m: SeenStore = {};
      for (const id of parsed) if (typeof id === "string") m[id] = 0;
      return m;
    }
    if (parsed && typeof parsed === "object") return parsed as SeenStore;
    return {};
  } catch {
    return {};
  }
}

function writeSeenStore(store: SeenStore) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(store));
  } catch {}
}

function markSeen(postId: string) {
  try {
    const store = readSeenStore();
    store[postId] = Date.now();
    const trimmed = Object.fromEntries(
      Object.entries(store)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, 1000)
    ) as SeenStore;
    writeSeenStore(trimmed);
  } catch {}
}

export default function WatchClient({
  startId,
  source,
  sourceKey,
}: {
  startId: string | null;
  source: string | null;
  sourceKey: string | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
const scrollerRef = useRef<HTMLDivElement | null>(null);
const WATCH_SCROLL_KEY = "peja-watch-scrollTop-v1";  
useEffect(() => {
  const el = scrollerRef.current;
  if (!el) return;

  // ✅ If watch opened for a specific post, start at top
  if (startId) {
    requestAnimationFrame(() => {
      el.scrollTop = 0;
      sessionStorage.setItem(WATCH_SCROLL_KEY, "0");
    });
    return;
  }

  // Otherwise restore
  const raw = sessionStorage.getItem(WATCH_SCROLL_KEY);
  const y = raw ? Number(raw) : 0;

  if (Number.isFinite(y) && y > 0) {
    requestAnimationFrame(() => {
      el.scrollTop = y;
    });
  }
}, [startId]);

useEffect(() => {
  const el = scrollerRef.current;
  if (!el) return;

  const onScroll = () => {
    sessionStorage.setItem(WATCH_SCROLL_KEY, String(el.scrollTop));
  };

  el.addEventListener("scroll", onScroll, { passive: true });
  return () => el.removeEventListener("scroll", onScroll);
}, []);

useEffect(() => {
  (window as any).__pejaWatchOpen = true;
  return () => {
    (window as any).__pejaWatchOpen = false;
  };
}, []);

  const { user } = useAuth();
  const { setSoundEnabled } = useAudio();

  const confirm = useConfirm();
  const confirmRef = useRef(confirm);

  useEffect(() => {
    confirmRef.current = confirm;
  }, [confirm]);

  const feedCache = useFeedCache();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  // for edge swipe close
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  // active reel detection
  const [activePostId, setActivePostId] = useState<string | null>(null);

  // horizontal carousel index per post
  const [mediaIndexByPost, setMediaIndexByPost] = useState<Record<string, number>>({});

  // when a *real modal* opens on top of watch (post detail), pause watch videos
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setModalOpen(true);
    const onClose = () => setModalOpen(false);

    window.addEventListener("peja-modal-open", onOpen);
    window.addEventListener("peja-modal-close", onClose);

    return () => {
      window.removeEventListener("peja-modal-open", onOpen);
      window.removeEventListener("peja-modal-close", onClose);
    };
  }, []);

  // sensitive reveal
  const [revealedSensitive, setRevealedSensitive] = useState<Set<string>>(new Set());
  const revealPost = (postId: string) => {
    setRevealedSensitive((prev) => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  };

  // views (once per watch session)
  const viewedRef = useRef<Set<string>>(new Set());
  const postsRef = useRef<Post[]>([]);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

const closeWatch = () => {
  window.dispatchEvent(new Event("peja-close-watch"));
};

  // LOAD POSTS (cache-first)
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // cache-first if sourceKey exists
      if (sourceKey) {
        const cached = feedCache.get(sourceKey);
        if (cached && cached.posts.length > 0) {
          const list = cached.posts;

          confirmRef.current.hydrateCounts(list.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 })));
          confirmRef.current.loadConfirmedFor(list.map((p) => p.id));

          if (!cancelled) {
            setPosts(list);
            setLoading(false);
          }
          return;
        }
      }

      // fallback fetch
      setLoading(true);

      const { data, error } = await supabase
        .from("posts")
        .select(`
          id, user_id, category, comment, address, latitude, longitude,
          is_anonymous, status, is_sensitive,
          confirmations, views, comment_count, report_count, created_at,
          post_media (id, post_id, url, media_type, is_sensitive, thumbnail_url)
        `)
        .in("status", ["live", "resolved"])
        .order("created_at", { ascending: false })
        .limit(80);

      if (cancelled) return;

      if (error) {
        console.error("Watch fetch error:", error);
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
          thumbnail_url: m.thumbnail_url,
        })),
        tags: [],
      }));

      confirmRef.current.hydrateCounts(formatted.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 })));
      confirmRef.current.loadConfirmedFor(formatted.map((p) => p.id));

      setPosts(formatted);
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, feedCache, startId]);

  const ordered = useMemo(() => {
    if (!startId) return posts;
    const idx = posts.findIndex((p) => p.id === startId);
    if (idx <= 0) return posts;
    return [posts[idx], ...posts.slice(0, idx), ...posts.slice(idx + 1)];
  }, [posts, startId]);

  // detect active reel (vertical)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-postid]"));
    if (els.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        let best: { id: string; ratio: number } | null = null;

        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.postid;
          if (!id) continue;
          if (!entry.isIntersecting) continue;

          const ratio = entry.intersectionRatio;
          if (!best || ratio > best.ratio) best = { id, ratio };
        }

        if (best && best.ratio >= 0.6) setActivePostId(best.id);
      },
      { threshold: [0.6, 0.75, 0.9] }
    );

    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [ordered.length]);

  useEffect(() => {
  if (!activePostId && ordered.length > 0) {
    setActivePostId(ordered[0].id);
  }
}, [ordered.length, activePostId]);

  const handleShare = async (postId: string) => {
    const url = `${window.location.origin}/post/${postId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Peja Alert", url });
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(url);
    alert("Link copied!");
  };

  const toggleConfirm = async (post: Post) => {
    if (!user) {
      router.push("/login");
      return;
    }

    const res = await confirm.toggle(post.id, post.confirmations || 0);

    if (res?.confirmed && post.user_id && post.user_id !== user.id) {
      notifyPostConfirmed(post.id, post.user_id, user.full_name || "Someone").catch(() => {});
    }
  };

  const markViewed = async (postId: string) => {
    if (viewedRef.current.has(postId)) return;
    viewedRef.current.add(postId);
    markSeen(postId);

    const current = postsRef.current.find((p) => p.id === postId);
    if (!current) return;

    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, views: (p.views || 0) + 1 } : p)));

    try {
      await supabase
        .from("posts")
        .update({ views: (current.views || 0) + 1 })
        .eq("id", postId);
    } catch {}
  };

if (loading) {
  return (
    <div className="fixed inset-0 bg-black z-[9999]">
      <div className="absolute top-4 right-4 z-50">
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>

      {/* fake reel */}
      <div className="h-full w-full flex items-center justify-center">
        <Skeleton className="h-[70vh] w-[92vw] max-w-xl rounded-2xl" />
      </div>

      {/* fake bottom overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <Skeleton className="h-4 w-4/5 mb-2" />
        <Skeleton className="h-4 w-3/5 mb-4" />
        <div className="flex gap-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
    </div>
  );
}

  return (
    <div
      className="fixed inset-0 bg-black z-[9999]"
      onPointerDown={(e) => {
        // user gesture => allow global unmute
        setSoundEnabled(true);
        swipeStartRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const s = swipeStartRef.current;
        swipeStartRef.current = null;
        if (!s) return;

        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;

        const fromLeftEdge = s.x <= 24;
        const fromRightEdge = s.x >= window.innerWidth - 24;
        const strongHorizontal = Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.3;

        if (strongHorizontal && ((fromLeftEdge && dx > 0) || (fromRightEdge && dx < 0))) {
          closeWatch();
        }
      }}
    >
      <button
        onClick={closeWatch}
        className="fixed top-4 right-4 z-50 p-2 rounded-full bg-black/60"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      >
        <X className="w-6 h-6 text-white" />
      </button>

<div ref={scrollerRef} className="h-full w-full overflow-y-scroll" style={{ scrollSnapType: "y mandatory" }}>
        {ordered.map((post) => {
          const isConfirmed = confirm.isConfirmed(post.id);
          const confirmCount = confirm.getCount(post.id, post.confirmations || 0);

          const activeMediaIndex = mediaIndexByPost[post.id] ?? 0;
          const isSensitive = !!post.is_sensitive;
          const isRevealed = revealedSensitive.has(post.id);

          return (
            <div
              key={post.id}
              data-postid={post.id}
              className="h-screen w-full relative"
              style={{ scrollSnapAlign: "start" }}
            >
              <div
                className="w-full h-full overflow-x-auto flex snap-x snap-mandatory"
                style={{ WebkitOverflowScrolling: "touch" }}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const w = el.clientWidth || 1;
                  const idx = Math.round(el.scrollLeft / w);
                  if (idx !== activeMediaIndex) {
                    setMediaIndexByPost((prev) => ({ ...prev, [post.id]: idx }));
                  }
                }}
              >
                {(post.media || []).map((m, idx) => {
                  const blocked = isSensitive && !isRevealed;

                  return (
                    <div key={m.id} className="w-full h-full shrink-0 snap-center flex items-center justify-center">
                      {blocked ? (
                        <div className="relative w-full h-full flex items-center justify-center bg-black">
                          {m.media_type === "video" ? (
                            <video
                              src={m.url}
                              className="w-full h-full object-contain blur-2xl opacity-60"
                              muted
                              playsInline
                              preload="metadata"
                            />
                          ) : (
                            <img src={m.url} alt="" className="w-full h-full object-contain blur-2xl opacity-60" />
                          )}

                          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
                            <div className="glass-float rounded-2xl px-5 py-4 max-w-sm">
                              <p className="text-white font-semibold mb-1">Sensitive content</p>
                              <p className="text-white/70 text-sm mb-4">
                                This post may contain graphic or disturbing media.
                              </p>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  revealPost(post.id);
                                }}
                                className="px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-medium"
                              >
                                View
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : m.media_type === "video" ? (
                        <ReelVideo
                          src={m.url}
                          active={!modalOpen && activePostId === post.id && activeMediaIndex === idx}
                          onWatched2s={() => markViewed(post.id)}
                        />
                      ) : (
                        <img src={m.url} alt="" className="h-full w-full object-contain" />
                      )}
                    </div>
                  );
                })}
              </div>

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
                      {confirmCount}
                    </button>

                    <button
                      onClick={() => router.push(`/post/${post.id}`, { scroll: false })}
                      className="flex items-center gap-1"
                    >
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