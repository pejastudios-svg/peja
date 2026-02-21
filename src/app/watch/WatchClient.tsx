"use client";

import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, REPORT_REASONS } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { notifyPostConfirmed } from "@/lib/notifications";
import { ReelVideo } from "@/components/reels/ReelVideo";
import { WatchCommentSheet } from "@/components/watch/WatchCommentSheet";
import { CheckCircle, MessageCircle, Share2, Eye, ChevronLeft, ChevronRight, Flag, Trash2, MoreVertical } from "lucide-react";
import { useFeedCache } from "@/context/FeedContext";
import { useConfirm } from "@/context/ConfirmContext";
import { useAudio } from "@/context/AudioContext";
import { Skeleton } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { formatDistanceToNow } from "date-fns";
import { useLongPress } from "@/components/hooks/useLongPress";
import { useToast } from "@/context/ToastContext";


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

// Simple image component with long press
function ImageWithLongPress({ url, onLongPress }: { url: string; onLongPress: () => void }) {
  const longPressProps = useLongPress(onLongPress, 500);
  
  return (
    <div 
      className="w-full h-full flex items-center justify-center"
      {...longPressProps}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img 
        src={url} 
        alt="" 
        className="max-h-full max-w-full object-contain select-none pointer-events-none" 
        draggable={false}
      />
    </div>
  );
}

// --- Helper Component for Carousel ---
function WatchMediaCarousel({ 
  media, 
  isActivePost, 
  activeMediaIndex, 
  onIndexChange, 
  isSensitive, 
  isRevealed, 
  onReveal, 
  onMarkViewed, 
  onOpenOptions, 
  onControlsChange
}: any) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const w = scrollRef.current.clientWidth;
    scrollRef.current.scrollBy({ left: direction === 'left' ? -w : w, behavior: 'smooth' });
  };

  // Long press handlers for images
  const handleImagePointerDown = (e: React.PointerEvent) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    
    longPressTimerRef.current = setTimeout(() => {
      onOpenOptions();
      longPressTimerRef.current = null;
    }, 500);
  };

  const handleImagePointerMove = (e: React.PointerEvent) => {
    // Cancel long press if finger moved too much
    if (pointerStartRef.current && longPressTimerRef.current) {
      const dx = Math.abs(e.clientX - pointerStartRef.current.x);
      const dy = Math.abs(e.clientY - pointerStartRef.current.y);
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handleImagePointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  };

  const handleImagePointerCancel = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  };

  return (
    <div className="relative w-full h-full">
      {/* Scrollable Carousel Container */}
      <div
        ref={scrollRef}
        className="w-full h-full overflow-x-auto flex snap-x snap-mandatory scrollbar-hide"
        style={{ 
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const w = el.clientWidth || 1;
          const idx = Math.round(el.scrollLeft / w);
          if (idx !== activeMediaIndex) onIndexChange(idx);
        }}
      >
        {media.map((m: any, idx: number) => {
          const blocked = isSensitive && !isRevealed;
          return (
            <div 
              key={m.id} 
              className="w-full h-full shrink-0 snap-center snap-always flex items-center justify-center relative"
              style={{ scrollSnapStop: "always" }}
            >
              {/* Context Menu Prevention Layer */}
              <div 
                className="absolute inset-0 z-0" 
                onContextMenu={(e) => e.preventDefault()} 
              />
               
              {blocked ? (
                <div className="relative w-full h-full flex items-center justify-center bg-black z-10">
                  <div className="glass-float rounded-2xl px-5 py-4 max-w-sm text-center">
                    <p className="text-white font-semibold mb-1">Sensitive content</p>
                    <button 
                      onClick={(e) => { e.stopPropagation(); onReveal(); }} 
                      className="mt-2 px-5 py-2 rounded-xl bg-primary-600 text-white"
                    >
                      View
                    </button>
                  </div>
                </div>
              ) : m.media_type === "video" ? (
                <ReelVideo
                  src={m.url}
                  active={isActivePost && activeMediaIndex === idx}
                  onWatched2s={onMarkViewed}
                  onLongPress={onOpenOptions}
                  onControlsChange={onControlsChange}
                />
              ) : (
  // ✅ Image with useLongPress hook (same as videos use)
  <ImageWithLongPress 
    url={m.url} 
    onLongPress={onOpenOptions} 
  />
)}
            </div>
          );
        })}
      </div>

      {/* Navigation Arrows - Only show if multiple items */}
      {media.length > 1 && (
        <>
          {activeMediaIndex > 0 && (
            <button 
              onClick={(e) => { e.stopPropagation(); scroll('left'); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/30 backdrop-blur-md text-white/80 hover:bg-black/50 z-20"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          {activeMediaIndex < media.length - 1 && (
            <button 
              onClick={(e) => { e.stopPropagation(); scroll('right'); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/30 backdrop-blur-md text-white/80 hover:bg-black/50 z-20"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
          
          {/* Bottom Dots Indicator */}
          <div className="absolute bottom-24 left-0 right-0 flex justify-center gap-2 z-20 pointer-events-none">
            {media.map((_: any, i: number) => (
              <div 
                key={i} 
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === activeMediaIndex 
                    ? "bg-white w-6" 
                    : "bg-white/40 w-2"
                }`} 
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// --- Main Component ---
export default function WatchClient({
  startId,
  source,
  sourceKey,
}: {
  startId: string | null;
  source: string | null;
  sourceKey: string | null;
}) {

   // ✅ DEBUG: Add this to see what values are being received
  useEffect(() => {
    console.log("[WatchClient] Received props:", { startId, source, sourceKey });
    
    if (sourceKey) {
      const cached = feedCache.get(sourceKey);
      console.log("[WatchClient] Cache for sourceKey:", sourceKey, "has", cached?.posts?.length || 0, "posts");
    }
  }, [startId, source, sourceKey]);


  const router = useRouter();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // ✅ FIX: Track if we've initialized to prevent re-fetching
  const initializedRef = useRef(false);

  // Prevent scroll on underlying page
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventBodyScroll = (e: TouchEvent) => {
      if (!container.contains(e.target as Node)) {
        e.preventDefault();
      }
    };

    document.addEventListener('touchmove', preventBodyScroll, { passive: false });
    
    return () => {
      document.removeEventListener('touchmove', preventBodyScroll);
    };
  }, []);

  // ✅ FIX: Save and restore scrollRestoration properly
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    
    const prev = history.scrollRestoration;
    history.scrollRestoration = "manual";
    
    // ✅ CRITICAL: Restore on unmount so back navigation works
    return () => {
      history.scrollRestoration = prev;
    };
  }, []);

  useEffect(() => {
    (window as any).__pejaWatchOpen = true;
    return () => { (window as any).__pejaWatchOpen = false; };
  }, []);

  const { user } = useAuth();
  const { setSoundEnabled } = useAudio();
  const confirm = useConfirm();
  const confirmRef = useRef(confirm);
  const feedCache = useFeedCache();
  const toast = useToast();


  useEffect(() => { confirmRef.current = confirm; }, [confirm]);

  // ✅ FIX: Use sourceKey to get the SAME posts from the page that launched watch
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [mediaIndexByPost, setMediaIndexByPost] = useState<Record<string, number>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showComments, setShowComments] = useState(false);

  const openComments = () => {
    window.history.pushState({ commentsOpen: true }, "", window.location.href);
    setShowComments(true);
  };

  const closeComments = () => {
    router.back(); 
  };

  useEffect(() => {
    const handlePopState = () => {
      if (showComments) setShowComments(false);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [showComments]);

  const activePost = posts.find(p => p.id === activePostId);

  const [descExpanded, setDescExpanded] = useState(false);
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
  console.log("[Watch] closeWatch called");
  sessionStorage.setItem("peja-returning-from-watch", Date.now().toString());
  console.log("[Watch] Flag set in sessionStorage");
  window.dispatchEvent(new Event("peja-close-watch"));
  router.back();
};

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxCaption, setLightboxCaption] = useState<string | null>(null);

  const openLightbox = (url: string, caption: string | null = null) => {
    setLightboxUrl(url);
    setLightboxCaption(caption);
    setLightboxOpen(true);
  };

  // Replace the init useEffect in WatchClient with this improved version:

useEffect(() => {
  if (initializedRef.current) return;
  initializedRef.current = true;

  let cancelled = false;

  const init = async () => {
    console.log("[Watch] Initializing with:", { startId, sourceKey });
    
    // ✅ STEP 1: Try to get posts from the SOURCE page's cache
    if (sourceKey) {
      const cached = feedCache.get(sourceKey);
      console.log("[Watch] Cache lookup for", sourceKey, "->", cached?.posts?.length || 0, "posts");
      
      if (cached?.posts?.length) {
        // Check if startId exists in cached posts
        const hasStartPost = cached.posts.some(p => p.id === startId);
        console.log("[Watch] startId", startId, "found in cache:", hasStartPost);
        
        if (hasStartPost || !startId) {
          setPosts(cached.posts);
          confirmRef.current.hydrateCounts(cached.posts.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 })));
          confirmRef.current.loadConfirmedFor(cached.posts.map((p) => p.id));
          setLoading(false);
          return;
        }
        // startId not in cache, fall through to fetch
        console.log("[Watch] startId not in cache, will fetch");
      }
    }

    // ✅ STEP 2: Fetch from database
    console.log("[Watch] Fetching from DB, startId:", startId);
    setLoading(true);

    try {
      // First, fetch the specific post if we have a startId
      let startPost: any = null;
      if (startId) {
        const { data, error } = await supabase
          .from("posts")
          .select(`
            id, user_id, category, comment, address, latitude, longitude,
            is_anonymous, status, is_sensitive,
            confirmations, views, comment_count, report_count, created_at,
            post_media (id, post_id, url, media_type, is_sensitive, thumbnail_url)
          `)
          .eq("id", startId)
          .single();
        
        if (error) {
          console.error("[Watch] Error fetching startId post:", error);
        } else {
          startPost = data;
          console.log("[Watch] Fetched startPost:", startPost?.id);
        }
      }

      // If we couldn't find the specific post, show error
      if (startId && !startPost) {
        console.error("[Watch] Could not find post with id:", startId);
        // Still continue to show other posts
      }

      // Fetch general posts
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
        console.error("[Watch] Error fetching posts:", error);
        setPosts([]);
        setLoading(false);
        return;
      }

      let formatted: Post[] = (data || []).map((p: any) => ({
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

      // If we fetched the startPost but it's not in the list, prepend it
      if (startPost && !formatted.some(p => p.id === startPost.id)) {
        const startFormatted: Post = {
          id: startPost.id,
          user_id: startPost.user_id,
          category: startPost.category,
          comment: startPost.comment,
          location: { latitude: startPost.latitude ?? 0, longitude: startPost.longitude ?? 0 },
          address: startPost.address,
          is_anonymous: startPost.is_anonymous,
          status: startPost.status,
          is_sensitive: startPost.is_sensitive,
          confirmations: startPost.confirmations || 0,
          views: startPost.views || 0,
          comment_count: startPost.comment_count || 0,
          report_count: startPost.report_count || 0,
          created_at: startPost.created_at,
          media: (startPost.post_media || []).map((m: any) => ({
            id: m.id,
            post_id: m.post_id,
            url: m.url,
            media_type: m.media_type,
            is_sensitive: m.is_sensitive,
            thumbnail_url: m.thumbnail_url,
          })),
          tags: [],
        };
        formatted = [startFormatted, ...formatted];
      }

      console.log("[Watch] Final posts count:", formatted.length);
      
      if (formatted.length === 0) {
        console.error("[Watch] No posts found!");
      }

      confirmRef.current.hydrateCounts(formatted.map((p) => ({ postId: p.id, confirmations: p.confirmations || 0 })));
      confirmRef.current.loadConfirmedFor(formatted.map((p) => p.id));
      setPosts(formatted);
      setLoading(false);
    } catch (err) {
      console.error("[Watch] Fetch error:", err);
      setPosts([]);
      setLoading(false);
    }
  };

  init();

  return () => { cancelled = true; };
}, [sourceKey, startId, feedCache]);

  // ✅ FIX: Reorder posts so startId is first
  const ordered = useMemo(() => {
    if (!startId || posts.length === 0) return posts;
    
    const idx = posts.findIndex((p) => p.id === startId);
    
    // Not found - keep as-is (shouldn't happen with our fetch fix above)
    if (idx === -1) {
      console.warn("[Watch] startId not found in posts:", startId);
      return posts;
    }
    
    // Already first
    if (idx === 0) return posts;
    
    // Move clicked post to front
    return [posts[idx], ...posts.slice(0, idx), ...posts.slice(idx + 1)];
  }, [posts, startId]);

  // Observer to track active post
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

  // ✅ FIX: Scroll to top (which shows startId post since it's first in ordered)
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || ordered.length === 0) return;
    
    // Always scroll to top - the first post IS the startId post
    el.scrollTop = 0;
  }, [ordered.length, startId]);

  // Set initial active post
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
  
  try {
    const { data: auth } = await supabase.auth.getSession();
    const token = auth.session?.access_token;

    if (!token) {
      toast.danger("Session expired. Please sign in again.");
      setSubmittingReport(false);
      return;
    }

    const res = await fetch("/api/report-post", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        postId: activePostForOptions.id,
        reason: reportReason,
        description: reportDescription,
      }),
    });

    const json = await res.json();

    if (!res.ok || !json.ok) {
      throw new Error(json.error || "Failed to report");
    }

    setShowReportModal(false);
    setShowOptions(false);
    setReportReason("");
    setReportDescription("");

    if (json.archived) {
      toast.success("Post removed due to reports");
      // Remove from local state
      setPosts(prev => prev.filter(p => p.id !== activePostForOptions.id));
    } else {
      toast.success("Report submitted");
    }
  } catch (err: any) {
    console.error("Report error:", err);
    toast.danger(err.message || "Failed to report");
  } finally {
    setSubmittingReport(false);
  }
};

 const handleDeletePost = async () => {
  if (!activePostForOptions || !user) return;
  
  setDeleting(true);
  
  try {
    const { data: auth } = await supabase.auth.getSession();
    const token = auth.session?.access_token;
    
    if (!token) {
      throw new Error("Session expired");
    }

    // Call user delete API
    const res = await fetch("/api/delete-my-post", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ postId: activePostForOptions.id }),
    });

    const json = await res.json();
    
    if (!res.ok || !json.ok) {
      throw new Error(json.error || "Failed to delete post");
    }

    const deletedPostId = activePostForOptions.id;

    // Remove from local state immediately
    setPosts(prev => prev.filter(p => p.id !== deletedPostId));
    
    setShowDeleteModal(false);
    setShowOptions(false);
    setActivePostForOptions(null);
    
    toast.success("Post deleted");
    
    // Dispatch event for other pages to update
    window.dispatchEvent(new CustomEvent("peja-post-deleted", { 
      detail: { postId: deletedPostId } 
    }));

    // If no posts left, close watch
    const remainingPosts = posts.filter(p => p.id !== deletedPostId);
    if (remainingPosts.length === 0) {
      closeWatch();
    }
    
  } catch (error: any) {
    console.error("Delete error:", error);
    toast.danger(error.message || "Failed to delete post");
  } finally {
    setDeleting(false);
  }
};

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black z-[9999]">
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
      ref={containerRef}
      className="fixed inset-0 bg-black z-[9999] overflow-hidden overscroll-none"
      style={{ touchAction: 'pan-y' }}
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

        if (strongVertical) {
           if (showComments) {
             closeComments();
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

          const containerStyle = isActivePost && showComments ? {
             transform: "scale(0.85) translateY(-15%)",
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
              style={{ scrollSnapAlign: "start", scrollSnapStop: "always" }}
            >
              {isActivePost && showComments && (
                <div 
                  className="absolute inset-0 z-40 cursor-pointer"
                  onClick={closeComments}
                />
              )}

              <div className="w-full h-full origin-top" style={containerStyle}>
                  <WatchMediaCarousel 
                    media={post.media} 
                    isActivePost={isActivePost} 
                    activeMediaIndex={activeMediaIndex} 
                    onIndexChange={(idx: number) => setMediaIndexByPost(prev => ({ ...prev, [post.id]: idx }))}
                    isSensitive={isSensitive}
                    isRevealed={isRevealed}
                    onReveal={() => revealPost(post.id)}
                    onMarkViewed={() => markViewed(post.id)}
                    onOpenOptions={() => { setActivePostForOptions(post); setShowOptions(true); }}
                    onControlsChange={isActivePost ? setControlsVisible : undefined}
                  />
                  
                  <div 
                    className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${showComments ? 'opacity-0' : 'opacity-100'}`}
                  >
                    <div className="absolute right-2 bottom-48 flex flex-col items-center gap-6 z-30 pointer-events-auto pb-safe">
                       <div className="flex flex-col items-center gap-1">
                          <button onClick={() => toggleConfirm(post)} className={`p-3 rounded-full backdrop-blur-md transition-colors ${isConfirmed ? "bg-primary-600/90 text-white" : "bg-black/40 text-white hover:bg-black/60"}`}>
                             <CheckCircle className={`w-8 h-8 ${isConfirmed ? "fill-current" : ""}`} />
                          </button>
                          <span className="text-white text-xs font-medium shadow-black drop-shadow-md">{confirmCount}</span>
                       </div>
                       <div className="flex flex-col items-center gap-1">
                          <button onClick={() => { if (isActivePost) openComments(); }} className="p-3 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60">
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

      {activePost && (
        <WatchCommentSheet 
          post={activePost}
          isOpen={showComments}
          onClose={closeComments}
          onCommentSuccess={() => {
            setPosts(prev => prev.map(p => 
              p.id === activePost!.id 
                ? { ...p, comment_count: (p.comment_count || 0) + 1 } 
                : p
            ));
          }}
          onViewAvatar={(url) => openLightbox(url, activePost!.is_anonymous ? "Anonymous" : "User Profile")}
        />
      )}

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

      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete Post">
        <p className="text-dark-300 text-sm mb-4">Delete this post permanently? This cannot be undone.</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
          <Button variant="danger" className="flex-1" onClick={handleDeletePost} isLoading={deleting}>Delete</Button>
        </div>
      </Modal>

      <ImageLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        imageUrl={lightboxUrl}
        caption={lightboxCaption}
      />
    </div>
  );
}