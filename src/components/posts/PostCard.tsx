"use client";

import { useState, useEffect, memo, useRef } from "react";
import { useRouter } from "next/navigation";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
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
import { supabase } from "@/lib/supabase";
import { notifyPostConfirmed } from "@/lib/notifications";

interface PostCardProps {
  post: Post;
  onConfirm?: (postId: string) => void;
  onShare?: (post: Post) => void;
}

function PostCardComponent({ post, onConfirm, onShare }: PostCardProps) {
  const router = useRouter();
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showSensitive, setShowSensitive] = useState(false);
  const [showFullComment, setShowFullComment] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [localConfirmations, setLocalConfirmations] = useState(post.confirmations);
  const [videoError, setVideoError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  
  // Prevent double-click on confirm
  const confirmingRef = useRef(false);

  const isExpired = differenceInHours(new Date(), new Date(post.created_at)) >= 24;

  useEffect(() => {
    setLocalConfirmations(post.confirmations);
  }, [post.confirmations]);

  useEffect(() => {
    let mounted = true;
    
    const checkConfirmed = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;

      const { data } = await supabase
        .from("post_confirmations")
        .select("id")
        .eq("post_id", post.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (mounted) {
        setIsConfirmed(!!data);
      }
    };

    checkConfirmed();
    
    return () => { mounted = false; };
  }, [post.id]);

  const handleConfirmClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Prevent double-click
    if (confirmingRef.current) {
      return;
    }
    confirmingRef.current = true;
    setConfirmLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const wasConfirmed = isConfirmed;
      const prevCount = localConfirmations;

      if (wasConfirmed) {
        // Unconfirm - optimistic update
        setIsConfirmed(false);
        setLocalConfirmations(Math.max(0, prevCount - 1));

        const { error: deleteError } = await supabase
          .from("post_confirmations")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", user.id);

        if (deleteError) {
          // Rollback on error
          setIsConfirmed(true);
          setLocalConfirmations(prevCount);
          throw deleteError;
        }

        await supabase
          .from("posts")
          .update({ confirmations: Math.max(0, prevCount - 1) })
          .eq("id", post.id);

      } else {
        // Confirm - optimistic update
        setIsConfirmed(true);
        setLocalConfirmations(prevCount + 1);

        const { error: insertError } = await supabase
          .from("post_confirmations")
          .insert({ post_id: post.id, user_id: user.id });

        if (insertError) {
          // Rollback on error (might be duplicate)
          if (insertError.code !== "23505") {
            setIsConfirmed(false);
            setLocalConfirmations(prevCount);
            throw insertError;
          }
        }

        await supabase
          .from("posts")
          .update({ confirmations: prevCount + 1 })
          .eq("id", post.id);

        // Notify post owner (if not self)
        if (post.user_id && post.user_id !== user.id) {
          const { data: userData } = await supabase
            .from("users")
            .select("full_name")
            .eq("id", user.id)
            .single();
          
          notifyPostConfirmed(
            post.id,
            post.user_id,
            userData?.full_name || "Someone"
          );
        }
      }

      onConfirm?.(post.id);
    } catch (error) {
      console.error("Confirm error:", error);
    } finally {
      setConfirmLoading(false);
      // Allow clicking again after a short delay
      setTimeout(() => {
        confirmingRef.current = false;
      }, 300);
    }
  };

  const category = CATEGORIES.find((c) => c.id === post.category);
  const badgeVariant = category?.color === "danger" ? "danger" : category?.color === "warning" ? "warning" : "info";

  const handlePrevMedia = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoError(false);
    setCurrentMediaIndex((prev) => prev === 0 ? (post.media?.length || 1) - 1 : prev - 1);
  };

  const handleNextMedia = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVideoError(false);
    setCurrentMediaIndex((prev) => prev === (post.media?.length || 1) - 1 ? 0 : prev + 1);
  };

  const handleCardClick = () => {
    router.push(`/post/${post.id}`);
  };

  const handleAddInfo = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/post/${post.id}`);
  };

  const handleShareClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onShare?.(post);
  };

  const currentMedia = post.media?.[currentMediaIndex];
  const commentText = post.comment || "";
  const isLongComment = commentText.length > 150;
  const displayedComment = isLongComment && !showFullComment ? commentText.slice(0, 150) + "..." : commentText;
  const timeAgo = formatDistanceToNow(new Date(post.created_at), { addSuffix: true });

  return (
    <article
      className="glass-card overflow-hidden cursor-pointer hover:ring-1 hover:ring-white/10 transition-all"
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

    if (currentMedia.media_type === "video") {
      router.push(`/watch?postId=${post.id}&source=home`);
      return;
    }

    // image
    setLightboxUrl(currentMedia.url);
    setLightboxOpen(true);
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
                    <video
                      key={currentMedia.url}
                      className="w-full h-full object-cover"
                      controls
                      playsInline
                      muted
                      preload="metadata"
                      src={currentMedia.url}
                      onError={() => setVideoError(true)}
                    />
                  )
                ) : (
                  <img
                    src={currentMedia?.url}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "/placeholder.jpg";
                    }}
                  />
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
                        className={`w-1.5 h-1.5 rounded-full ${idx === currentMediaIndex ? "bg-white" : "bg-white/40"}`}
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
          <p className="text-dark-200 text-sm wrap-break-words">{displayedComment}</p>
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
        <span key={tag} className="text-xs text-primary-400 break-all max-w-full">
        #{tag}
        </span>
        ))}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center justify-between text-sm text-dark-400 mb-4">
        <span className="flex items-center gap-1">
          <CheckCircle className={`w-4 h-4 ${isConfirmed ? "text-primary-400 fill-primary-400" : ""}`} />
          {localConfirmations}
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
          disabled={confirmLoading}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            isConfirmed
              ? "bg-primary-600 text-white"
              : "glass-sm text-dark-200 hover:bg-white/10"
          } ${confirmLoading ? "opacity-70" : ""}`}
        >
          {confirmLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle className={`w-4 h-4 ${isConfirmed ? "fill-current" : ""}`} />
          )}
          <span>{isConfirmed ? "Confirmed" : "Confirm"}</span>
        </button>

        <button
          onClick={handleAddInfo}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium glass-sm text-dark-200 hover:bg-white/10"
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
/>
    </article>
  );
}

// Memoize to prevent unnecessary re-renders
export const PostCard = memo(PostCardComponent);