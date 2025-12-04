"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
} from "lucide-react";
import { Post, CATEGORIES } from "@/lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { supabase } from "@/lib/supabase";

interface PostCardProps {
  post: Post;
  onConfirm?: (postId: string) => void;
  onShare?: (post: Post) => void;
}

export function PostCard({ post, onConfirm, onShare }: PostCardProps) {
  const router = useRouter();
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showSensitive, setShowSensitive] = useState(false);
  const [timeAgo, setTimeAgo] = useState("");
  const [showFullComment, setShowFullComment] = useState(false);

  // Confirmation state
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [localConfirmations, setLocalConfirmations] = useState(post.confirmations);

  // Check if post is older than 24 hours
  const isExpired = differenceInHours(new Date(), new Date(post.created_at)) >= 24;

  useEffect(() => {
    setTimeAgo(formatDistanceToNow(new Date(post.created_at), { addSuffix: true }));
  }, [post.created_at]);

  useEffect(() => {
    checkIfConfirmed();
  }, [post.id]);

  useEffect(() => {
    setLocalConfirmations(post.confirmations);
  }, [post.confirmations]);

  const checkIfConfirmed = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("post_confirmations")
        .select("id")
        .eq("post_id", post.id)
        .eq("user_id", user.id)
        .maybeSingle();

      setIsConfirmed(!!data);
    } catch (error) {
      console.error("Error checking confirmation:", error);
    }
  };

  const handleConfirmClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      if (isConfirmed) {
        setIsConfirmed(false);
        setLocalConfirmations((prev) => Math.max(0, prev - 1));

        await supabase
          .from("post_confirmations")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", user.id);

        await supabase
          .from("posts")
          .update({ confirmations: Math.max(0, localConfirmations - 1) })
          .eq("id", post.id);
      } else {
        setIsConfirmed(true);
        setLocalConfirmations((prev) => prev + 1);

        await supabase
          .from("post_confirmations")
          .insert({ post_id: post.id, user_id: user.id });

        await supabase
          .from("posts")
          .update({ confirmations: localConfirmations + 1 })
          .eq("id", post.id);
      }

      onConfirm?.(post.id);
    } catch (error) {
      setIsConfirmed(!isConfirmed);
      setLocalConfirmations(post.confirmations);
      console.error("Error toggling confirmation:", error);
    } finally {
      setConfirmLoading(false);
    }
  };

  const category = CATEGORIES.find((c) => c.id === post.category);

  const badgeVariant =
    category?.color === "danger"
      ? "danger"
      : category?.color === "warning"
      ? "warning"
      : category?.color === "awareness"
      ? "info"
      : "default";

  const handlePrevMedia = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMediaIndex((prev) =>
      prev === 0 ? (post.media?.length || 1) - 1 : prev - 1
    );
  };

  const handleNextMedia = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMediaIndex((prev) =>
      prev === (post.media?.length || 1) - 1 ? 0 : prev + 1
    );
  };

  const handleCardClick = () => {
    router.push(`/post/${post.id}`);
  };

  const handleAddInfo = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/post/${post.id}#comments`);
  };

  const handleShareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShare?.(post);
  };

  const currentMedia = post.media?.[currentMediaIndex];
  
  // Check if comment is long
 const commentText = post.comment || "";
const isLongComment = commentText.length > 150;
const displayedComment = isLongComment && !showFullComment 
  ? commentText.slice(0, 150) + "..." 
  : commentText;

  return (
    <article
      className="glass-card overflow-hidden cursor-pointer hover:ring-1 hover:ring-white/10 transition-all"
      onClick={handleCardClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Show LIVE only if not expired */}
          {!isExpired ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-xs font-medium text-red-400">LIVE</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-dark-500 rounded-full" />
            </span>
          )}
          <span className="text-dark-600">|</span>
          <span className="text-xs text-dark-400 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {post.distance
              ? `${(post.distance / 1000).toFixed(1)}km away`
              : post.address || "Unknown location"}
          </span>
        </div>
        <span className="text-xs text-dark-500 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {timeAgo || "Just now"}
        </span>
      </div>

      {/* Media */}
      {post.media && post.media.length > 0 && (
        <div className="relative -mx-6 mb-3" onClick={(e) => e.stopPropagation()}>
          {post.is_sensitive && !showSensitive ? (
            <div className="aspect-video bg-dark-800 flex flex-col items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-orange-400 mb-2" />
              <p className="text-sm text-dark-300 mb-1">Sensitive Content</p>
              <p className="text-xs text-dark-500 mb-3">
                This may contain graphic imagery
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSensitive(true);
                }}
              >
                View Content
              </Button>
            </div>
          ) : (
            <>
              <div className="aspect-video relative bg-dark-900">
{currentMedia?.media_type === "video" ? (
  <div className="relative w-full h-full bg-black">
    <video
      key={currentMedia.url}
      className="w-full h-full object-contain"
      controls
      playsInline
      preload="metadata"
      poster={currentMedia.thumbnail_url}
      onError={(e) => {
        console.error("Video error:", e);
        const target = e.target as HTMLVideoElement;
        if (target.error) {
          console.error("Video error details:", target.error.message);
        }
      }}
      onLoadStart={() => {
        console.log("Video started loading");
      }}
      onCanPlay={() => {
        console.log("Video can play");
      }}
    >
      <source src={currentMedia.url} type="video/mp4" />
      <source src={currentMedia.url} type="video/quicktime" />
      <source src={currentMedia.url} type="video/webm" />
      <source src={currentMedia.url} type="video/x-m4v" />
      Your browser does not support the video tag.
    </video>
  </div>
) : (
  <img
    src={currentMedia?.url || "/placeholder.jpg"}
    alt="Post media"
    className="w-full h-full object-cover"
    onError={(e) => {
      console.error("Image error:", e);
    }}
  />
)}
              </div>

              {post.media.length > 1 && (
                <>
                  <button
                    onClick={handlePrevMedia}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5 text-white" />
                  </button>
                  <button
                    onClick={handleNextMedia}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
                  >
                    <ChevronRight className="w-5 h-5 text-white" />
                  </button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
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

      {/* Category */}
      <div className="mb-3">
        <Badge variant={badgeVariant}>{category?.name || post.category}</Badge>
      </div>

      {/* Comment with View More */}
      {post.comment && (
        <div className="mb-3">
          <p className="text-dark-200 text-sm">
            {displayedComment}
          </p>
          {isLongComment && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowFullComment(!showFullComment);
              }}
              className="flex items-center gap-1 mt-1 text-xs text-primary-400 hover:text-primary-300"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${showFullComment ? "rotate-180" : ""}`} />
              {showFullComment ? "Show less" : "View more"}
            </button>
          )}
        </div>
      )}

      {/* Tags */}
      {post.tags && post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {post.tags.map((tag) => (
            <span key={tag} className="text-xs text-primary-400">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center justify-between text-sm text-dark-400 mb-4">
        <span className="flex items-center gap-1">
          <CheckCircle
            className={`w-4 h-4 ${isConfirmed ? "text-primary-400 fill-primary-400" : ""}`}
          />
          {localConfirmations} confirmed
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className="w-4 h-4" />
          {post.comment_count || 0} comments
        </span>
        <span className="flex items-center gap-1">
          <Eye className="w-4 h-4" />
          {post.views} views
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-3 border-t border-white/5">
        <button
          onClick={handleConfirmClick}
          disabled={confirmLoading}
          className={`
            flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl
            text-sm font-medium transition-all duration-200
            ${
              isConfirmed
                ? "bg-primary-600 text-white shadow-lg shadow-primary-600/25"
                : "glass-sm text-dark-200 hover:bg-white/10"
            }
            ${confirmLoading ? "opacity-70 cursor-not-allowed" : ""}
            active:scale-95
          `}
        >
          {confirmLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle
              className={`w-4 h-4 transition-transform duration-200 ${
                isConfirmed ? "fill-current scale-110" : ""
              }`}
            />
          )}
          <span>{isConfirmed ? "Confirmed!" : "Confirm"}</span>
        </button>

        <button
          onClick={handleAddInfo}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium glass-sm text-dark-200 hover:bg-white/10 transition-colors active:scale-95"
        >
          <MessageCircle className="w-4 h-4" />
          <span>Add Info</span>
        </button>

        <button
          onClick={handleShareClick}
          className="p-2 rounded-xl glass-sm text-dark-200 hover:bg-white/10 transition-colors active:scale-95"
        >
          <Share2 className="w-4 h-4" />
        </button>
      </div>
    </article>
  );
}