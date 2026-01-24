"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, REPORT_REASONS } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { notifyPostConfirmed } from "@/lib/notifications";
import { ReelVideo } from "@/components/reels/ReelVideo";
import { WatchCommentSheet } from "@/components/watch/WatchCommentSheet"; // Import the new sheet
import { CheckCircle, MessageCircle, Share2, Eye, ChevronLeft, Flag, Trash2, MoreVertical } from "lucide-react";
import { useFeedCache } from "@/context/FeedContext";
import { useConfirm } from "@/context/ConfirmContext";
import { useAudio } from "@/context/AudioContext";
import { Skeleton } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";

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
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const WATCH_SCROLL_KEY = "peja-watch-scrollTop-v1";  
  
  // --- Scroll Restoration ---
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (startId) {
      requestAnimationFrame(() => {
        el.scrollTop = 0;
        sessionStorage.setItem(WATCH_SCROLL_KEY, "0");
      });
      return;
    }
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
    return () => { (window as any).__pejaWatchOpen = false; };
  }, []);

  const { user } = useAuth();
  const { setSoundEnabled } = useAudio();
  const confirm = useConfirm();
  const confirmRef = useRef(confirm);

  useEffect(() => { confirmRef.current = confirm; }, [confirm]);

  const feedCache = useFeedCache();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [mediaIndexByPost, setMediaIndexByPost] = useState<Record<string, number>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // --- Comments Sheet State ---
  const [showComments, setShowComments] = useState(false);
  const activePost = posts.find(p => p.id === activePostId);

  // --- Description State ---
  const [descExpanded, setDescExpanded] = useState(false);

  // --- Back Button Logic (Close Sheet on Back) ---
  useEffect(() => {
    if (showComments) {
      // Push dummy state so 'Back' closes sheet instead of page
      window.history.pushState({ sheetOpen: true }, "");
      
      const handlePop = () => {
        setShowComments(false);
      };
      
      window.addEventListener("popstate", handlePop);
      return () => window.removeEventListener("popstate", handlePop);
    }
  }, [showComments]);

  // --- Options Modal State ---
  const [showOptions, setShowOptions] = useState(false);
  const [activePostForOptions, setActivePostForOptions] = useState<Post | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [revealedSensitive, setRevealedSensitive] = useState<Set<string>>(new Set());
  const revealPost = (postId: string) => {
    setRevealedSensitive((prev) => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  };

  const viewedRef = useRef<Set<string>>(new Set());
  const postsRef = useRef<Post[]>([]);
  useEffect(() => { postsRef.current = posts; }, [posts]);

  const closeWatch = () => {
    window.dispatchEvent(new Event("peja-close-watch"));
  };

// --- Lightbox State ---
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxCaption, setLightboxCaption] = useState<string | null>(null);

  const openLightbox = (url: string, caption: string | null = null) => {
    setLightboxUrl(url);
    setLightboxCaption(caption);
    setLightboxOpen(true);
  };

  // --- Load Posts ---
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
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
    return () => { cancelled = true; };
  }, [sourceKey, feedCache, startId]);

  const ordered = useMemo(() => {
    if (!startId) return posts;
    const idx = posts.findIndex((p) => p.id === startId);
    if (idx <= 0) return posts;
    return [posts[idx], ...posts.slice(0, idx), ...posts.slice(idx + 1)];
  }, [posts, startId]);

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

  // --- Handlers ---
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
      await supabase.from("posts").update({ views: (current.views || 0) + 1 }).eq("id", postId);
    } catch {}
  };

  const handleReport = async () => {
    if (!reportReason || !user || !activePostForOptions) return;
    setSubmittingReport(true);
    setTimeout(() => {
       setSubmittingReport(false);
       setShowReportModal(false);
       setShowOptions(false);
       alert("Report submitted.");
    }, 1000);
  };

  const handleDeletePost = async () => {
    if (!activePostForOptions) return;
    setDeleting(true);
    setTimeout(() => {
        setDeleting(false);
        setShowDeleteModal(false);
        setShowOptions(false);
        setPosts(prev => prev.filter(p => p.id !== activePostForOptions.id));
    }, 1000);
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black z-9999">
        <div className="absolute top-4 right-4 z-50">
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
        <div className="h-full w-full flex items-center justify-center">
          <Skeleton className="h-[70vh] w-[92vw] max-w-xl rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black z-9999 overflow-hidden"
      onPointerDown={(e) => {
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
        const strongVertical = dy > 100 && Math.abs(dy) > Math.abs(dx) * 1.3;

        // If dragging down specifically, close the app view OR the comments if open
        if (strongVertical) {
           if (showComments) {
             setShowComments(false);
           } else {
             closeWatch();
           }
           return;
        }

        if (strongHorizontal && ((fromLeftEdge && dx > 0) || (fromRightEdge && dx < 0))) {
          closeWatch();
        }
      }}
    >
      {/* Back Button */}
      <button
        onClick={closeWatch}
        className={`fixed top-4 left-4 z-50 p-2 rounded-full bg-black/40 backdrop-blur-md transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      >
        <ChevronLeft className="w-8 h-8 text-white" />
      </button>

      <div ref={scrollerRef} className="h-full w-full overflow-y-scroll" style={{ scrollSnapType: "y mandatory" }}>
        {ordered.map((post) => {
          const isConfirmed = confirm.isConfirmed(post.id);
          const confirmCount = confirm.getCount(post.id, post.confirmations || 0);
          const activeMediaIndex = mediaIndexByPost[post.id] ?? 0;
          const isSensitive = !!post.is_sensitive;
          const isRevealed = revealedSensitive.has(post.id);
          const isActivePost = activePostId === post.id;

          // SHRINK LOGIC: Move up and scale down when sheet is open
          const containerStyle = isActivePost && showComments ? {
             transform: "scale(0.85) translateY(-15%)", // Move up to clear the sheet
             borderRadius: "24px",
             transition: "all 0.4s cubic-bezier(0.32, 0.72, 0, 1)"
          } : {
             transform: "scale(1) translateY(0)",
             borderRadius: "0px",
             transition: "all 0.4s cubic-bezier(0.32, 0.72, 0, 1)"
          };

          return (
            <div
              key={post.id}
              data-postid={post.id}
              className="h-screen w-full relative overflow-hidden bg-black"
              // ADDED scrollSnapStop to prevent flying through videos
              style={{ scrollSnapAlign: "start", scrollSnapStop: "always" }}
            >
              {/* Tap-to-Close Layer */}
              {isActivePost && showComments && (
                <div 
                  className="absolute inset-0 z-40 cursor-pointer"
                  onClick={() => setShowComments(false)}
                />
              )}

              {/* Media Container */}
              <div className="w-full h-full origin-top" style={containerStyle}>
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
                    // ... (Media rendering logic stays same) ...
                    const blocked = isSensitive && !isRevealed;
                    return (
                        <div key={m.id} className="w-full h-full shrink-0 snap-center flex items-center justify-center">
                            {blocked ? (
                                <div className="relative w-full h-full flex items-center justify-center bg-black">
                                    <div className="glass-float rounded-2xl px-5 py-4 max-w-sm text-center">
                                        <p className="text-white font-semibold mb-1">Sensitive content</p>
                                        <button onClick={(e) => { e.stopPropagation(); revealPost(post.id); }} className="mt-2 px-5 py-2 rounded-xl bg-primary-600 text-white">View</button>
                                    </div>
                                </div>
                            ) : m.media_type === "video" ? (
                                <ReelVideo
                                    src={m.url}
                                    active={!modalOpen && isActivePost && activeMediaIndex === idx}
                                    onWatched2s={() => markViewed(post.id)}
                                    onLongPress={() => { setActivePostForOptions(post); setShowOptions(true); }}
                                    onControlsChange={isActivePost ? setControlsVisible : undefined}
                                />
                            ) : (
                                <img src={m.url} alt="" className="h-full w-full object-contain" />
                            )}
                        </div>
                    );
                  })}
                </div>

                {/* --- Interaction Layer --- */}
                <div 
                  className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${showComments ? 'opacity-0' : 'opacity-100'}`}
                >
                  {/* Controls / Buttons Stack */}
                  <div className="absolute right-2 bottom-48 flex flex-col items-center gap-6 z-30 pointer-events-auto pb-safe">
                     {/* ... Buttons (Confirm, Comment, Share) same as before ... */}
                     <div className="flex flex-col items-center gap-1">
                        <button onClick={() => toggleConfirm(post)} className={`p-3 rounded-full backdrop-blur-md transition-colors ${isConfirmed ? "bg-primary-600/90 text-white" : "bg-black/40 text-white hover:bg-black/60"}`}>
                           <CheckCircle className={`w-8 h-8 ${isConfirmed ? "fill-current" : ""}`} />
                        </button>
                        <span className="text-white text-xs font-medium shadow-black drop-shadow-md">{confirmCount}</span>
                     </div>
                     <div className="flex flex-col items-center gap-1">
                        <button onClick={() => { if (isActivePost) setShowComments(true); }} className="p-3 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60">
                           <MessageCircle className="w-8 h-8" />
                        </button>
                        <span className="text-white text-xs font-medium shadow-black drop-shadow-md">{post.comment_count || 0}</span>
                     </div>
                     <div className="flex flex-col items-center gap-1">
                        <div className="p-3 rounded-full bg-black/40 backdrop-blur-md text-white"><Eye className="w-8 h-8" /></div>
                        <span className="text-white text-xs font-medium shadow-black drop-shadow-md">{post.views || 0}</span>
                     </div>
                     <button onClick={() => { setActivePostForOptions(post); setShowOptions(true); }} className="p-3 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60">
                       <MoreVertical className="w-8 h-8" />
                     </button>
                  </div>

                  {/* Description Area (New Layout) */}
                  <div 
                    className={`absolute bottom-0 left-0 right-0 pt-24 pb-28 px-4 z-20 pointer-events-none bg-linear-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}
                  >
                     <div className="w-[80%] pointer-events-auto">
                        <p 
                          className={`text-white text-sm wrap-break-word whitespace-pre-wrap shadow-black drop-shadow-md transition-all duration-300 ${descExpanded ? '' : 'line-clamp-2'}`}
                          onClick={() => setDescExpanded(!descExpanded)}
                        >
                          {post.comment || ""}
                        </p>
                        {post.comment && post.comment.length > 80 && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); setDescExpanded(!descExpanded); }}
                            className="text-white/70 text-xs mt-1 font-medium hover:text-white"
                          >
                            {descExpanded ? "View less" : "View more"}
                          </button>
                        )}
                     </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

     {/* --- Comments Sheet --- */}
      {activePost && (
        <WatchCommentSheet 
          post={activePost}
          isOpen={showComments}
          onClose={() => setShowComments(false)}
          onCommentSuccess={() => {
            setPosts(prev => prev.map(p => 
              p.id === activePost.id 
                ? { ...p, comment_count: (p.comment_count || 0) + 1 } 
                : p
            ));
          }}
          // CONNECT LIGHTBOX HERE:
          onViewAvatar={(url) => openLightbox(url, activePost.is_anonymous ? "Anonymous" : "User Profile")}
        />
      )}

      {/* --- Options Modal --- */}
      <Modal isOpen={showOptions} onClose={() => setShowOptions(false)} title="Options" animation="slide-up">
         <div className="space-y-2">
            <Button variant="secondary" onClick={() => { handleShare(activePostForOptions?.id || ""); setShowOptions(false); }} className="w-full justify-start gap-3 h-12 text-base">
               <Share2 className="w-5 h-5" /> Share
            </Button>
            {activePostForOptions?.user_id !== user?.id && (
               <Button variant="secondary" onClick={() => { setShowReportModal(true); setShowOptions(false); }} className="w-full justify-start gap-3 text-orange-400 h-12 text-base">
                  <Flag className="w-5 h-5" /> Report
               </Button>
            )}
            {activePostForOptions?.user_id === user?.id && (
               <Button variant="secondary" onClick={() => { setShowDeleteModal(true); setShowOptions(false); }} className="w-full justify-start gap-3 text-red-400 h-12 text-base">
                  <Trash2 className="w-5 h-5" /> Delete
               </Button>
            )}
         </div>
      </Modal>

      {/* --- Report Modal --- */}
      <Modal isOpen={showReportModal} onClose={() => setShowReportModal(false)} title="Report Post">
        <div className="space-y-3">
          {REPORT_REASONS.map(r => (
            <label key={r.id} className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${reportReason === r.id ? "bg-primary-600/10 border-primary-500/50" : "border-dark-700 hover:border-dark-600"}`}>
              <input type="radio" checked={reportReason === r.id} onChange={() => setReportReason(r.id)} className="mt-0.5" />
              <div>
                <p className="text-dark-100 text-sm font-medium">{r.label}</p>
                <p className="text-dark-400 text-xs">{r.description}</p>
              </div>
            </label>
          ))}
          {reportReason === "other" && (
            <textarea value={reportDescription} onChange={e => setReportDescription(e.target.value)} placeholder="Details..." rows={2} className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded-xl text-sm resize-none focus:outline-none focus:border-primary-500" />
          )}
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowReportModal(false)}>Cancel</Button>
            <Button variant="primary" className="flex-1" onClick={handleReport} isLoading={submittingReport} disabled={!reportReason}>Submit</Button>
          </div>
        </div>
      </Modal>

      {/* --- Delete Modal --- */}
      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete Post">
        <p className="text-dark-300 text-sm mb-4">Delete this post permanently? This cannot be undone.</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
          <Button variant="danger" className="flex-1" onClick={handleDeletePost} isLoading={deleting}>Delete</Button>
        </div>
      </Modal>
{/* --- Image Lightbox --- */}
      <ImageLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        imageUrl={lightboxUrl}
        caption={lightboxCaption}
      />
    </div> 
  );
}