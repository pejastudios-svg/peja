"use client";

import { useState, useEffect } from "react";
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
} from "lucide-react";
import { Post, CATEGORIES } from "@/lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { formatDistanceToNow } from "date-fns";

interface PostCardProps {
  post: Post;
  onConfirm?: (postId: string) => void;
  onShare?: (post: Post) => void;
}

export function PostCard({ post, onConfirm, onShare }: PostCardProps) {
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showSensitive, setShowSensitive] = useState(false);
  const [timeAgo, setTimeAgo] = useState("");

  useEffect(() => {
    setTimeAgo(formatDistanceToNow(new Date(post.created_at), { addSuffix: true }));
  }, [post.created_at]);

  const category = CATEGORIES.find((c) => c.id === post.category);
  const isLive = post.status === "live";

  const badgeVariant =
    category?.color === "danger"
      ? "danger"
      : category?.color === "warning"
      ? "warning"
      : category?.color === "awareness"
      ? "info"
      : "default";

  const handlePrevMedia = () => {
    setCurrentMediaIndex((prev) =>
      prev === 0 ? (post.media?.length || 1) - 1 : prev - 1
    );
  };

  const handleNextMedia = () => {
    setCurrentMediaIndex((prev) =>
      prev === (post.media?.length || 1) - 1 ? 0 : prev + 1
    );
  };

  const currentMedia = post.media?.[currentMediaIndex];

  return (
    <article className="glass-card overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isLive ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-xs font-medium text-red-400">LIVE</span>
            </span>
          ) : (
            <span className="text-xs text-dark-400">Resolved</span>
          )}
          <span className="text-dark-600">|</span>
          <span className="text-xs text-dark-400 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {post.distance ? `${(post.distance / 1000).toFixed(1)}km away` : post.address}
          </span>
        </div>
        <span className="text-xs text-dark-500 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {timeAgo || "Just now"}
        </span>
      </div>

      {post.media && post.media.length > 0 && (
        <div className="relative -mx-6 mb-3">
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
                onClick={() => setShowSensitive(true)}
              >
                View Content
              </Button>
            </div>
          ) : (
            <>
              <div className="aspect-video relative bg-dark-900">
                {currentMedia?.media_type === "video" ? (
                  <video
                    src={currentMedia.url}
                    className="w-full h-full object-cover"
                    controls
                  />
                ) : (
                  <img
                    src={currentMedia?.url || "/placeholder.jpg"}
                    alt="Post media"
                    className="w-full h-full object-cover"
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
                          idx === currentMediaIndex
                            ? "bg-white"
                            : "bg-white/40"
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

      <div className="mb-3">
        <Badge variant={badgeVariant}>{category?.name || post.category}</Badge>
      </div>

      {post.comment && (
        <p className="text-dark-200 text-sm mb-3">{post.comment}</p>
      )}

      {post.tags && post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {post.tags.map((tag) => (
            <span key={tag} className="text-xs text-primary-400">
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-dark-400 mb-4">
        <span className="flex items-center gap-1">
          <CheckCircle className="w-4 h-4" />
          {post.confirmations} confirmed
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className="w-4 h-4" />
          12 comments
        </span>
        <span className="flex items-center gap-1">
          <Eye className="w-4 h-4" />
          {post.views} views
        </span>
      </div>

      <div className="flex gap-2 pt-3 border-t border-white/5">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={() => onConfirm?.(post.id)}
          leftIcon={<CheckCircle className="w-4 h-4" />}
        >
          Confirm
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          leftIcon={<MessageCircle className="w-4 h-4" />}
        >
          Add Info
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onShare?.(post)}
        >
          <Share2 className="w-4 h-4" />
        </Button>
      </div>
    </article>
  );
}