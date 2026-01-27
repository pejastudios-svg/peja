"use client";

import { useState, useEffect, memo } from "react";
import { useRouter } from "next/navigation";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { VideoLightbox } from "@/components/ui/VideoLightbox";
import { InlineVideo } from "@/components/reels/InlineVideo";
import { useConfirm } from "@/context/ConfirmContext";
import { useAuth } from "@/context/AuthContext";
import { useFeedCache } from "@/context/FeedContext"; // ✅ ADD THIS IMPORT
import {
  MapPin,
  Clock,
  CheckCircle,
  MessageCircle,
  Eye,
  Share2,
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
import { notifyPostConfirmed } from "@/lib/notifications";

interface PostCardProps {
  post: Post;
  sourceKey?: string;
  onConfirm?: (postId: string) => void;
  onShare?: (post: Post) => void;
}

function PostCardComponent({ post, onConfirm, onShare, sourceKey }: PostCardProps) {
  const router = useRouter();
  const feedCache = useFeedCache(); // ✅ ADD THIS

  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showSensitive, setShowSensitive] = useState(false);
  const [showFullComment, setShowFullComment] = useState(false);
  const [videoError, setVideoError] = useState(false);

  // Lightbox States
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [videoLightboxOpen, setVideoLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxItems, setLightboxItems] = useState<{ url: string; type: "image" | "video" }[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const [confirming, setConfirming] = useState(false);

  const { user } = useAuth();
  const confirm = useConfirm();

  const isConfirmed = confirm.isConfirmed(post.id);
  const confirmations = confirm.getCount(post.id, post.confirmations || 0);

  useEffect(() => {
    confirm.hydrateCounts([{ postId: post.id, confirmations: post.confirmations || 0 }]);
  }, [post.id]);

  const isExpired = differenceInHours(new Date(), new Date(post.created_at)) >= 24;

  const handleConfirmClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!user) {
      router.push("/login");
      return;
    }

    if (confirming) return;
    setConfirming(true);

    try {
      const res = await confirm.toggle(post.id, post.confirmations || 0);

      if (res?.confirmed && post.user_id && post.user_id !== user.id) {
        notifyPostConfirmed(post.id, post.user_id, user.full_name || "Someone");
      }

      onConfirm?.(post.id);
    } finally {
      setConfirming(false);
    }
  };

  const category = CATEGORIES.find((c) => c.id === post.category);
  const badgeVariant =
    category?.color === "danger" ? "danger" : category?.color === "warning" ? "warning" : "info";

  const handlePrevMedia = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoError(false);
    setCurrentMediaIndex((prev) => (prev === 0 ? (post.media?.length || 1) - 1 : prev - 1));
  };

  const handleNextMedia = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoError(false);
    setCurrentMediaIndex((prev) =>
      prev === (post.media?.length || 1) - 1 ? 0 : prev + 1
    );
  };

  // ✅ FIXED: Save scroll position before navigating to watch
  const handleCardClick = () => {
  const currentScroll = window.scrollY;
  
  // Save to FeedContext
  if (sourceKey) {
    feedCache.setScroll(sourceKey, currentScroll);
  }
  
  // ✅ ALSO save to sessionStorage as backup (survives navigation)
  sessionStorage.setItem("peja-scroll-restore", JSON.stringify({
    key: sourceKey,
    scrollY: currentScroll,
    timestamp: Date.now()
  }));
  
  console.log("[PostCard] Saved scroll:", currentScroll, "for", sourceKey);
  
  router.push(`/watch?postId=${post.id}&sourceKey=${encodeURIComponent(sourceKey || "feed")}`);
};

  const handleExpandVideo = () => {
    const media = post.media?.[currentMediaIndex];
    if (media && media.media_type === 'video') {
        setLightboxUrl(media.url);
        setVideoLightboxOpen(true);
    }
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

  const handleShareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShare?.(post);
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
      className="glass-card overflow-hidden cursor-pointer hover:ring-1 hover:ring-white/10 transition-all active:scale-[0.99] duration-200"
      onClick={handleCardClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {!isExpired ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-xs font-medium text-red-400">LIVE</span>
            </span>
          ) : (
            <span className="w-2 h-2 bg-dark-500 rounded-full" />
          )}
          <span className="text-dark-600">|</span>
          <span className="text-xs text-dark-400 flex items-center gap-1 truncate max-w-[150px]">
            <MapPin className="w-3 h-3 shrink-0" />
            {post.address || "Unknown location"}
          </span>
        </div>
        <span className="text-xs text-dark-500 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {timeAgo}
        </span>
      </div>

      {/* Media */}
      {post.media && post.media.length > 0 && (
        <div
          className="relative -mx-6 mb-3"
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
              <div className="aspect-video relative bg-dark-900">
                {currentMedia?.media_type === "video" ? (
                  videoError ? (
                    <div className="w-full h-full flex items-center justify-center bg-dark-800">
                      <div className="text-center">
                        <Play className="w-10 h-10 text-dark-500 mx-auto mb-2" />
                        <p className="text-dark-400 text-sm">Video unavailable</p>
                      </div>
                    </div>
                  ) : (
                    <InlineVideo
                      src={currentMedia.url}
                      poster={currentMedia.thumbnail_url}
                      className="w-full h-full object-cover"
                      showExpand={true}
                      showMute={true}
                      onExpand={handleExpandVideo}
                      onError={() => setVideoError(true)}
                    />
                  )
                ) : (
                  <img src={currentMedia?.url} alt="" className="w-full h-full object-cover" />
                )}
              </div>

              {post.media.length > 1 && (
                <>
                  <button
                    onClick={handlePrevMedia}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
                  >
                    <ChevronLeft className="w-5 h-5 text-white" />
                  </button>
                  <button
                    onClick={handleNextMedia}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
                  >
                    <ChevronRight className="w-5 h-5 text-white" />
                  </button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                    {post.media.map((_, idx) => (
                      <div
                        key={idx}
                        className={`w-1.5 h-1.5 rounded-full ${
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
          <CheckCircle className={`w-4 h-4 ${isConfirmed ? "text-primary-400 fill-primary-400" : ""}`} />
          {confirmations}
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className="w-4 h-4" />
          {post.comment_count || 0}
        </span>
        <span className="flex items-center gap-1">
          <Eye className="w-4 h-4" />
          {post.views}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-white/5">
        <button
          onClick={handleConfirmClick}
          disabled={confirming}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            isConfirmed ? "bg-primary-600 text-white" : "glass-sm text-dark-200 hover:bg-white/10"
          } ${confirming ? "opacity-70" : ""}`}
        >
          {confirming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle className={`w-4 h-4 ${isConfirmed ? "fill-current" : ""}`} />
          )}
          <span>{isConfirmed ? "Confirmed" : "Confirm"}</span>
        </button>

        <button
          onClick={handleAddInfo}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium glass-sm text-dark-200 hover:bg-white/10 active:scale-90 transition-transform duration-150"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Comment</span>
        </button>

        <button
          onClick={handleShareClick}
          className="p-2 rounded-xl glass-sm text-dark-200 hover:bg-white/10"
        >
          <Share2 className="w-4 h-4" />
        </button>
      </div>

      <ImageLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        imageUrl={lightboxUrl}
        caption={post.comment || null}
        items={lightboxItems}
        initialIndex={lightboxIndex}
      />
      
      <VideoLightbox 
        isOpen={videoLightboxOpen}
        onClose={() => setVideoLightboxOpen(false)}
        videoUrl={lightboxUrl}
      />
    </article>
  );
}

export const PostCard = memo(PostCardComponent);