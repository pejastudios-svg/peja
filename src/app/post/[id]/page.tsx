"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  MapPin,
  Clock,
  Eye,
  CheckCircle,
  Share2,
  Flag,
  MessageCircle,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Send,
} from "lucide-react";

export default function PostDetailPage() {
  const router = useRouter();
  const params = useParams();
  const postId = params.id as string;

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showSensitive, setShowSensitive] = useState(false);

  useEffect(() => {
    if (postId) {
      fetchPost();
      checkIfConfirmed();
    }
  }, [postId]);

  const fetchPost = async () => {
    try {
      const { data, error } = await supabase
        .from("posts")
        .select(`
          *,
          post_media (*),
          post_tags (tag)
        `)
        .eq("id", postId)
        .single();

      if (error) throw error;

      if (data) {
        const formattedPost: Post = {
          id: data.id,
          user_id: data.user_id,
          category: data.category,
          comment: data.comment,
          location: { latitude: 0, longitude: 0 },
          address: data.address,
          is_anonymous: data.is_anonymous,
          status: data.status,
          is_sensitive: data.is_sensitive,
          confirmations: data.confirmations || 0,
          views: data.views || 0,
          created_at: data.created_at,
          media:
            data.post_media?.map((m: any) => ({
              id: m.id,
              post_id: m.post_id,
              url: m.url,
              media_type: m.media_type as "photo" | "video",
              is_sensitive: m.is_sensitive,
              thumbnail_url: m.thumbnail_url,
            })) || [],
          tags: data.post_tags?.map((t: any) => t.tag) || [],
        };
        setPost(formattedPost);

        // Increment views
        await supabase
          .from("posts")
          .update({ views: (data.views || 0) + 1 })
          .eq("id", postId);
      }
    } catch (err: any) {
      console.error("Error fetching post:", err);
      setError("Post not found");
    } finally {
      setLoading(false);
    }
  };

  const checkIfConfirmed = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("post_confirmations")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .maybeSingle();

    setIsConfirmed(!!data);
  };

  const handleConfirm = async () => {
    setConfirmLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      if (isConfirmed) {
        // Remove confirmation
        await supabase
          .from("post_confirmations")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", user.id);

        await supabase
          .from("posts")
          .update({ confirmations: Math.max(0, (post?.confirmations || 1) - 1) })
          .eq("id", postId);

        setIsConfirmed(false);
        setPost((prev) =>
          prev ? { ...prev, confirmations: Math.max(0, prev.confirmations - 1) } : null
        );
      } else {
        // Add confirmation
        await supabase
          .from("post_confirmations")
          .insert({ post_id: postId, user_id: user.id });

        await supabase
          .from("posts")
          .update({ confirmations: (post?.confirmations || 0) + 1 })
          .eq("id", postId);

        setIsConfirmed(true);
        setPost((prev) =>
          prev ? { ...prev, confirmations: prev.confirmations + 1 } : null
        );
      }
    } catch (error) {
      console.error("Error confirming:", error);
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/post/${postId}`;
    const shareText = post?.comment || "Check out this incident on Peja";

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Peja Alert",
          text: shareText,
          url: shareUrl,
        });
      } catch (error) {
        console.log("Share cancelled");
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      alert("Link copied to clipboard!");
    }
  };

  const handlePrevMedia = () => {
    setCurrentMediaIndex((prev) =>
      prev === 0 ? (post?.media?.length || 1) - 1 : prev - 1
    );
  };

  const handleNextMedia = () => {
    setCurrentMediaIndex((prev) =>
      prev === (post?.media?.length || 1) - 1 ? 0 : prev + 1
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  // Error state
  if (error || !post) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <AlertTriangle className="w-16 h-16 text-red-400 mb-4" />
        <h1 className="text-xl font-bold text-dark-100 mb-2">Post Not Found</h1>
        <p className="text-dark-400 mb-6 text-center">
          This incident may have been removed or doesn't exist.
        </p>
        <Button variant="primary" onClick={() => router.push("/")}>
          Go Home
        </Button>
      </div>
    );
  }

  const category = CATEGORIES.find((c) => c.id === post.category);
  const badgeVariant =
    category?.color === "danger"
      ? "danger"
      : category?.color === "warning"
      ? "warning"
      : category?.color === "awareness"
      ? "info"
      : "default";

  const currentMedia = post.media?.[currentMediaIndex];

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/5">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Incident Details</h1>
          <button
            onClick={handleShare}
            className="p-2 -mr-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <Share2 className="w-5 h-5 text-dark-200" />
          </button>
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto">
        {/* Media Gallery */}
        {post.media && post.media.length > 0 && (
          <div className="relative aspect-video bg-dark-800">
            {post.is_sensitive && !showSensitive ? (
              <div className="w-full h-full flex flex-col items-center justify-center">
                <AlertTriangle className="w-12 h-12 text-orange-400 mb-3" />
                <p className="text-dark-300 mb-1">Sensitive Content</p>
                <p className="text-sm text-dark-500 mb-4">
                  This may contain graphic imagery
                </p>
                <Button variant="secondary" size="sm" onClick={() => setShowSensitive(true)}>
                  View Content
                </Button>
              </div>
            ) : (
              <>
                {currentMedia?.media_type === "video" ? (
                  <video
                    src={currentMedia.url}
                    controls
                    className="w-full h-full object-contain bg-black"
                  />
                ) : (
                  <img
                    src={currentMedia?.url}
                    alt="Incident"
                    className="w-full h-full object-contain"
                  />
                )}

                {/* Media navigation */}
                {post.media.length > 1 && (
                  <>
                    <button
                      onClick={handlePrevMedia}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full hover:bg-black/70"
                    >
                      <ChevronLeft className="w-6 h-6 text-white" />
                    </button>
                    <button
                      onClick={handleNextMedia}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 rounded-full hover:bg-black/70"
                    >
                      <ChevronRight className="w-6 h-6 text-white" />
                    </button>
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                      {post.media.map((_, index) => (
                        <button
                          key={index}
                          onClick={() => setCurrentMediaIndex(index)}
                          className={`w-2 h-2 rounded-full transition-colors ${
                            index === currentMediaIndex ? "bg-white" : "bg-white/40"
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

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Status & Category */}
          <div className="flex items-center justify-between">
            <Badge variant={badgeVariant}>{category?.name || post.category}</Badge>
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                post.status === "live"
                  ? "bg-green-500/20 text-green-400"
                  : "bg-dark-600 text-dark-300"
              }`}
            >
              {post.status === "live" ? "🔴 LIVE" : "Resolved"}
            </span>
          </div>

          {/* Comment */}
          {post.comment && (
            <p className="text-dark-100 text-lg leading-relaxed">{post.comment}</p>
          )}

          {/* Meta info */}
          <div className="flex flex-wrap gap-4 text-sm text-dark-400">
            {post.address && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                <span>{post.address}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              <span>
                {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Eye className="w-4 h-4" />
              <span>{post.views} views</span>
            </div>
          </div>

          {/* Tags */}
          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {post.tags.map((tag, index) => (
                <span key={index} className="text-primary-400 text-sm">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={handleConfirm}
              disabled={confirmLoading}
              className={`
                flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl
                text-sm font-medium transition-all duration-200
                ${
                  isConfirmed
                    ? "bg-primary-500 text-white shadow-lg shadow-primary-500/25"
                    : "glass-sm text-dark-200 hover:bg-white/10"
                }
                ${confirmLoading ? "opacity-70 cursor-not-allowed" : ""}
              `}
            >
              {confirmLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <CheckCircle className={`w-5 h-5 ${isConfirmed ? "fill-current" : ""}`} />
              )}
              <span>{isConfirmed ? "Confirmed!" : "Confirm"}</span>
              <span className={isConfirmed ? "text-primary-200" : "text-dark-400"}>
                ({post.confirmations})
              </span>
            </button>

            <button
              onClick={() => {
                /* TODO: Report */
              }}
              className="p-3 rounded-xl glass-sm text-dark-400 hover:bg-white/10 hover:text-red-400 transition-colors"
            >
              <Flag className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Comments Section */}
        <div id="comments" className="p-4 border-t border-white/5">
          <h3 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <MessageCircle className="w-5 h-5" />
            Updates & Comments
          </h3>

          {/* Comment Input */}
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              placeholder="Add an update or comment..."
              className="flex-1 px-4 py-3 glass-input"
            />
            <button className="p-3 bg-primary-600 rounded-xl text-white hover:bg-primary-700 transition-colors">
              <Send className="w-5 h-5" />
            </button>
          </div>

          {/* Empty state */}
          <div className="text-center py-8">
            <MessageCircle className="w-12 h-12 text-dark-600 mx-auto mb-3" />
            <p className="text-dark-400">No comments yet</p>
            <p className="text-sm text-dark-500">Be the first to add information</p>
          </div>
        </div>
      </main>
    </div>
  );
}