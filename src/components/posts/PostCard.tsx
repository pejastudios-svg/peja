"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { InlineVideo } from "@/components/reels/InlineVideo";
import { useConfirm } from "@/context/ConfirmContext";
import { useAuth } from "@/context/AuthContext";
import { useFeedCache } from "@/context/FeedContext";
import { useToast } from "@/context/ToastContext";
import { getVideoThumbnailUrl, getOptimizedVideoUrl, preloadVideoChunk } from "@/lib/videoThumbnail";
import { formatCount } from "@/lib/utils";
import { ConfirmConfetti } from "@/components/ui/ConfirmConfetti";
import { shareUrl } from "@/lib/share";
import { VideoLightbox } from "@/components/ui/VideoLightbox";
import { IncidentForwardSheet } from "@/components/messages-v2/IncidentForwardSheet";

import {
  MapPin,
  Clock,
  CheckCircle,
  MessageCircle,
  Eye,
  Share2,
  Send,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ChevronDown,
  Play,
} from "lucide-react";
import { Post, CATEGORIES } from "@/lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { formatDistanceToNow, differenceInHours } from "date-fns";

interface PostCardProps {
  post: Post;
  sourceKey?: string;
  onConfirm?: (postId: string) => void;
  onShare?: (post: Post) => void;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function PostCardComponent({ post, onConfirm, onShare, sourceKey }: PostCardProps) {
  const router = useRouter();
  const feedCache = useFeedCache(); 
  const toast = useToast();

  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showSensitive, setShowSensitive] = useState(false);
  const [showFullComment, setShowFullComment] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoLightboxOpen, setVideoLightboxOpen] = useState(false);
  const [videoLightboxUrl, setVideoLightboxUrl] = useState<string | null>(null);
  const [videoStartTime, setVideoStartTime] = useState(0);
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null);
  // Preload video thumbnails eagerly
  useEffect(() => {
    const videos = post.media?.filter(m => m.media_type === "video") || [];
    videos.forEach(v => {
      const thumbUrl = v.thumbnail_url || getVideoThumbnailUrl(v.url);
      if (thumbUrl) {
        const img = new Image();
        img.src = thumbUrl;
      }
    });
  }, [post.media]);
  // Lightbox States
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxItems, setLightboxItems] = useState<{ url: string; type: "image" | "video" }[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Optimistic local state for instant UI feedback
const [optimisticConfirmed, setOptimisticConfirmed] = useState<boolean | null>(null);
const [optimisticCount, setOptimisticCount] = useState<number | null>(null);
const [confettiTrigger, setConfettiTrigger] = useState(false);
const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const { user } = useAuth();
  const confirm = useConfirm();

  // Only VIPs / MVPs / admins can DM, so only they should see the
  // "Send to chat" button — regular users can't open any chat from
  // here anyway (gate is also enforced server-side by peja_can_dm).
  const canForwardToChat =
    user?.is_vip === true || user?.is_mvp === true || user?.is_admin === true;
  const [forwardSheetOpen, setForwardSheetOpen] = useState(false);

  // Use optimistic state if available, otherwise use context
const isConfirmed = optimisticConfirmed ?? confirm.isConfirmed(post.id);
const confirmations = optimisticCount ?? confirm.getCount(post.id, post.confirmations || 0);

useEffect(() => {
    confirm.hydrateCounts([{ postId: post.id, confirmations: post.confirmations || 0 }]);
    confirm.loadConfirmedFor([post.id]);
  }, [post.id]);

  // Preload first video chunk when card mounts (for faster playback)
useEffect(() => {
    const firstVideo = post.media?.find(m => m.media_type === "video");
    if (firstVideo) {
      preloadVideoChunk(getOptimizedVideoUrl(firstVideo.url));
    }
  }, [post.id]);

  const isExpired = differenceInHours(new Date(), new Date(post.created_at)) >= 24;

  // Distance from user — only shown when both user and post have coordinates.
  const distanceText = (() => {
    const ulat = user?.last_latitude;
    const ulng = user?.last_longitude;
    const plat = post.location?.latitude;
    const plng = post.location?.longitude;
    if (ulat == null || ulng == null || !plat || !plng) return null;
    return formatDistance(haversineKm(ulat, ulng, plat, plng));
  })();

const handleConfirmClick = async (e: React.MouseEvent) => {
  e.stopPropagation();

  if (!user) {
    router.push("/login");
    return;
  }

  // Get current state before toggle
  const wasConfirmed = confirm.isConfirmed(post.id);
  const currentCount = confirm.getCount(post.id, post.confirmations || 0);

  // Optimistic update - instant UI change
  setOptimisticConfirmed(!wasConfirmed);
  setOptimisticCount(wasConfirmed ? Math.max(0, currentCount - 1) : currentCount + 1);
if (!wasConfirmed) {
    setConfettiTrigger(false);
    requestAnimationFrame(() => setConfettiTrigger(true));
  }
  try {
    const res = await confirm.toggle(post.id, post.confirmations || 0);

    // Clear optimistic state - context now has the truth
    setOptimisticConfirmed(null);
    setOptimisticCount(null);



    onConfirm?.(post.id);
  } catch {
    // Revert on error
    setOptimisticConfirmed(null);
    setOptimisticCount(null);
  }
};

  const category = CATEGORIES.find((c) => c.id === post.category);
  const badgeVariant =
    category?.color === "danger" ? "danger" : category?.color === "warning" ? "warning" : "info";

  // Scroll-snap carousel: chevrons scroll the container; index updates via
  // onScroll. Native swipe just works because the container is overflow-x.
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const handlePrevMedia = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoError(false);
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: -el.clientWidth, behavior: "smooth" });
  };

  const handleNextMedia = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoError(false);
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: el.clientWidth, behavior: "smooth" });
  };

  const handleScrollerScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !post.media?.length) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx >= 0 && idx < post.media.length && idx !== currentMediaIndex) {
      setCurrentMediaIndex(idx);
    }
  }, [currentMediaIndex, post.media]);

  // ✅ FIXED: Save scroll position before navigating to watch
  const handleCardClick = () => {
  // Save scroll position
  if (sourceKey) {
    feedCache.setScroll(sourceKey, window.scrollY);
  }
  
  // Navigate to post detail instead of watch (watch is disabled for now)
  const sk = sourceKey ? `?sourceKey=${encodeURIComponent(sourceKey)}` : "";
  router.push(`/post/${post.id}${sk}`, { scroll: false });
};


  const handleAddInfo = (e: React.MouseEvent) => {
    e.stopPropagation();
    // ✅ Also save scroll when opening post detail
    if (sourceKey) {
      feedCache.setScroll(sourceKey, window.scrollY);
    }
    const sk = sourceKey ? `?sourceKey=${encodeURIComponent(sourceKey)}` : "";
    router.push(`/post/${post.id}${sk}`, { scroll: false });
  };

const handleExpandVideo = (currentTime?: number, posterDataUrl?: string) => {
    const media = post.media?.[currentMediaIndex];
    if (!media) return;
    setVideoLightboxUrl(media.url);
    setVideoStartTime(currentTime ?? 0);
    setVideoThumbnail(posterDataUrl || media.thumbnail_url || getVideoThumbnailUrl(media.url) || null);
    setVideoLightboxOpen(true);
  };

const handleShareClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `https://peja.life/post/${post.id}`;
    const result = await shareUrl({
      title: "Peja Alert",
      text: post.comment || category?.name || "Check out this incident",
      url,
    });
    if (result === "copied") {
      toast.success("Link copied!");
    }
  };

  const currentMedia = post.media?.[currentMediaIndex];
  const commentText = post.comment || "";
  const isLongComment = commentText.length > 150;
  const displayedComment =
    isLongComment && !showFullComment ? commentText.slice(0, 150) + "..." : commentText;

  const timeAgo = formatDistanceToNow(new Date(post.created_at), { addSuffix: true });

  const openLightboxAt = (index: number) => {
    const items: { url: string; type: "image" | "video" }[] = (post.media || []).map((m) => ({
      url: m.url,
      type: m.media_type === "video" ? "video" : "image",
    }));

    setLightboxItems(items);
    setLightboxIndex(index);
    setLightboxUrl(post.media?.[index]?.url || null);
    setLightboxOpen(true);
  };

  return (
    <article
      className="glass-card-feed overflow-hidden cursor-pointer sm:hover:ring-1 sm:hover:ring-white/10 transition-all active:scale-[0.99] duration-200"
      onClick={handleCardClick}
    >
      {/* Top section — padded so header chips don't touch the edge */}
      <div className="px-4 sm:px-6 pt-4 sm:pt-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 min-w-0">
        {!isExpired ? (
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-xs font-bold text-red-400 tracking-wide">LIVE</span>
          </span>
        ) : (
          <span className="w-2 h-2 bg-dark-500 rounded-full shrink-0" />
        )}

        {distanceText && post.location && (
          <Link
            href={`/?flyto=${post.location.latitude},${post.location.longitude}&label=${encodeURIComponent(post.address || "Incident location")}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-semibold beacon-accent-text shrink-0 hover:bg-primary-500/10 active:scale-95 transition-all"
          >
            <MapPin className="w-3 h-3" />
            {distanceText}
          </Link>
        )}

        <span className="text-xs text-dark-400 flex items-center gap-1 min-w-0 flex-1">
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">{post.address || "Unknown location"}</span>
        </span>

        <span className="text-xs text-dark-500 flex items-center gap-1 shrink-0">
          <Clock className="w-3 h-3 shrink-0" />
          {timeAgo}
        </span>
      </div>
      </div>
      {/* end top padded section */}

      {/* Media — edge-to-edge: card has no internal padding so this naturally spans full width */}
      {post.media && post.media.length > 0 && (
        <div
          className="relative"
          onClick={(e) => {
            e.stopPropagation();
            if (!currentMedia) return;

            if (currentMedia.media_type !== "video") {
              openLightboxAt(currentMediaIndex);
            } else {
               handleCardClick();
            }
          }}
        >
          {post.is_sensitive && !showSensitive ? (
            <div className="aspect-video bg-dark-800 flex flex-col items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-orange-400 mb-2" />
              <p className="text-sm text-dark-300 mb-1">Sensitive Content</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSensitive(true);
                }}
              >
                View
              </Button>
            </div>
          ) : (
            <>
              <div
                ref={scrollerRef}
                onScroll={handleScrollerScroll}
                className="aspect-video relative bg-dark-900 flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                <style jsx>{`
                  div::-webkit-scrollbar { display: none; }
                `}</style>
                {post.media.map((m, idx) => {
                  const isCurrent = idx === currentMediaIndex;
                  const isVideo = m.media_type === "video";
                  return (
                    <div
                      key={m.id || `${idx}-${m.url}`}
                      className="snap-center shrink-0 w-full h-full relative"
                    >
                      {isVideo ? (
                        isCurrent && !videoError ? (
                          <InlineVideo
                            src={m.url}
                            poster={m.thumbnail_url || getVideoThumbnailUrl(m.url) || undefined}
                            className="w-full h-full object-cover"
                            showExpand={true}
                            showMute={true}
                            postId={post.id}
                            onExpand={handleExpandVideo}
                            onError={() => setVideoError(true)}
                          />
                        ) : isCurrent && videoError ? (
                          <div className="w-full h-full flex items-center justify-center bg-dark-800">
                            <div className="text-center">
                              <Play className="w-10 h-10 text-dark-500 mx-auto mb-2" />
                              <p className="text-dark-400 text-sm">Video unavailable</p>
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-full bg-dark-800 relative">
                            {(m.thumbnail_url || getVideoThumbnailUrl(m.url)) && (
                              <img
                                src={m.thumbnail_url || getVideoThumbnailUrl(m.url) || ""}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            )}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                                <Play className="w-5 h-5 text-white ml-0.5" />
                              </div>
                            </div>
                          </div>
                        )
                      ) : (
                        <img
                          src={m.url}
                          alt=""
                          className="w-full h-full object-cover"
                          loading={idx === 0 ? "eager" : "lazy"}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {post.media.length > 1 && (
                <>
                  <button
                    onClick={handlePrevMedia}
                    className="absolute left-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center active:bg-black/70 z-10"
                  >
                    <ChevronLeft className="w-5 h-5 text-white" />
                  </button>
                  <button
                    onClick={handleNextMedia}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center active:bg-black/70 z-10"
                  >
                    <ChevronRight className="w-5 h-5 text-white" />
                  </button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10">
                    {post.media.map((_, idx) => (
                      <div
                        key={idx}
                        className={`w-1.5 h-1.5 rounded-full transition-colors ${
                          idx === currentMediaIndex ? "bg-white" : "bg-white/40"
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Bottom section — padded so text/buttons don't touch the screen edge */}
      <div className="px-4 sm:px-6 pt-3 pb-4 sm:pb-5">
      {/* Category */}
      <div className="mb-3">
        <Badge variant={badgeVariant}>{category?.name || post.category}</Badge>
      </div>

      {/* Comment */}
      {post.comment && (
        <div className="mb-3">
          <p className="text-dark-200 text-sm wrap-break-word whitespace-pre-wrap overflow-hidden">
            {displayedComment}
          </p>
          {isLongComment && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowFullComment(!showFullComment);
              }}
              className="flex items-center gap-1 mt-1 text-xs text-primary-400"
            >
              <ChevronDown className={`w-3 h-3 ${showFullComment ? "rotate-180" : ""}`} />
              {showFullComment ? "Less" : "More"}
            </button>
          )}
        </div>
      )}

      {/* Tags */}
      {post.tags && post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3 min-w-0">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs text-primary-400 max-w-full wrap-anywhere"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center justify-between text-sm text-dark-400 mb-4">
        <span className="flex items-center gap-1">
          <CheckCircle className={`w-4 h-4 ${isConfirmed ? "text-primary-400" : ""}`} />
          {formatCount(confirmations)}
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className="w-4 h-4" />
          {formatCount(post.comment_count || 0)}
        </span>
        <span className="flex items-center gap-1">
          <Eye className="w-4 h-4" />
          {formatCount(post.views)}
        </span>
      </div>

      {/* Actions. Uses the theme-aware --soft-surface-strong (white tint in
          dark, black tint in light) instead of bg-white/10 + border-white/5,
          which are invisible on the light theme's white background. */}
      <div className="flex gap-2 pt-3 border-t border-[var(--soft-surface-strong)]">
<button
  ref={confirmBtnRef}
  onClick={handleConfirmClick}
  data-tutorial="post-confirm"
  className={`relative flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-95 ${
    isConfirmed ? "bg-primary-600 text-white" : "action-chip text-dark-200 hover:bg-[var(--soft-surface-strong)]"
  }`}
>
  <ConfirmConfetti trigger={confettiTrigger} />
  <CheckCircle className="w-4 h-4" strokeWidth={2.2} />
  <span>{isConfirmed ? "Confirmed" : "Confirm"}</span>
</button>

        <button
          onClick={handleAddInfo}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium action-chip text-dark-200 hover:bg-[var(--soft-surface-strong)] active:scale-90 transition-transform duration-150"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Comment</span>
        </button>

        {canForwardToChat && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setForwardSheetOpen(true);
            }}
            className="p-2 rounded-xl action-chip text-dark-200 hover:bg-[var(--soft-surface-strong)] active:scale-90 transition-transform duration-150"
            aria-label="Send to chat"
          >
            <Send className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={handleShareClick}
          className="p-2 rounded-xl action-chip text-dark-200 hover:bg-[var(--soft-surface-strong)]"
        >
          <Share2 className="w-4 h-4" />
        </button>
      </div>
      </div>
      {/* end bottom padded section */}

      <ImageLightbox
  isOpen={lightboxOpen}
  onClose={() => setLightboxOpen(false)}
  imageUrl={lightboxUrl}
  caption={post.comment || null}
  items={lightboxItems}
  initialIndex={lightboxIndex}
  postId={post.id} 
  onLongPress={() => {
    setLightboxOpen(false);
  }}
/>

      <VideoLightbox
        isOpen={videoLightboxOpen}
        onClose={() => setVideoLightboxOpen(false)}
        videoUrl={videoLightboxUrl}
        startTime={videoStartTime}
        postId={post.id}
        posterUrl={videoThumbnail}
      />

      {forwardSheetOpen && user && (
        <IncidentForwardSheet
          currentUserId={user.id}
          messageBody={`https://peja.life/post/${post.id}`}
          onClose={() => setForwardSheetOpen(false)}
          onSent={(count) => {
            toast.success(
              count === 1 ? "Sent to 1 chat" : `Sent to ${count} chats`
            );
          }}
          onError={() => {
            toast.danger("Couldn't send. Try again.");
          }}
        />
      )}

    </article>
  );
}

export const PostCard = memo(PostCardComponent);