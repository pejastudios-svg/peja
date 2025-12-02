"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, Comment, CATEGORIES, REPORT_REASONS } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/context/AuthContext";
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
  Trash2,
  User,
  MoreVertical,
  X,
} from "lucide-react";

export default function PostDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const postId = params.id as string;

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showSensitive, setShowSensitive] = useState(false);

  // Comment state
  const [newComment, setNewComment] = useState("");
  const [commentAnonymous, setCommentAnonymous] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  // Report modal
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  // Delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Options menu
  const [showOptions, setShowOptions] = useState(false);

  const isOwner = user?.id === post?.user_id;

  useEffect(() => {
    if (postId) {
      fetchPost();
      fetchComments();
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

  const fetchComments = async () => {
    try {
      const { data, error } = await supabase
        .from("post_comments")
        .select(`
          *,
          users:user_id (full_name, avatar_url)
        `)
        .eq("post_id", postId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      setComments(
        data?.map((c: any) => ({
          id: c.id,
          post_id: c.post_id,
          user_id: c.user_id,
          content: c.content,
          is_anonymous: c.is_anonymous,
          created_at: c.created_at,
          user: c.users,
        })) || []
      );
    } catch (error) {
      console.error("Error fetching comments:", error);
    }
  };

  const checkIfConfirmed = async () => {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return;

    const { data } = await supabase
      .from("post_confirmations")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", authUser.id)
      .maybeSingle();

    setIsConfirmed(!!data);
  };

  const handleConfirm = async () => {
    setConfirmLoading(true);
    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();

      if (!authUser) {
        router.push("/login");
        return;
      }

      if (isConfirmed) {
        await supabase
          .from("post_confirmations")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", authUser.id);

        await supabase
          .from("posts")
          .update({ confirmations: Math.max(0, (post?.confirmations || 1) - 1) })
          .eq("id", postId);

        setIsConfirmed(false);
        setPost((prev) =>
          prev ? { ...prev, confirmations: Math.max(0, prev.confirmations - 1) } : null
        );
      } else {
        await supabase
          .from("post_confirmations")
          .insert({ post_id: postId, user_id: authUser.id });

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

  const handleSubmitComment = async () => {
    if (!newComment.trim()) return;

    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      router.push("/login");
      return;
    }

    setSubmittingComment(true);
    try {
      const { data, error } = await supabase
        .from("post_comments")
        .insert({
          post_id: postId,
          user_id: authUser.id,
          content: newComment.trim(),
          is_anonymous: commentAnonymous,
        })
        .select(`
          *,
          users:user_id (full_name, avatar_url)
        `)
        .single();

      if (error) throw error;

      setComments((prev) => [
        ...prev,
        {
          id: data.id,
          post_id: data.post_id,
          user_id: data.user_id,
          content: data.content,
          is_anonymous: data.is_anonymous,
          created_at: data.created_at,
          user: data.users,
        },
      ]);
      setNewComment("");
      setCommentAnonymous(false);
    } catch (error) {
      console.error("Error submitting comment:", error);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await supabase.from("post_comments").delete().eq("id", commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (error) {
      console.error("Error deleting comment:", error);
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

  const handleReport = async () => {
    if (!reportReason) return;

    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      router.push("/login");
      return;
    }

    setSubmittingReport(true);
    try {
      await supabase.from("post_reports").insert({
        post_id: postId,
        user_id: authUser.id,
        reason: reportReason,
        description: reportDescription,
      });

      setShowReportModal(false);
      setReportReason("");
      setReportDescription("");
      alert("Report submitted. Thank you for helping keep Peja safe!");
    } catch (error: any) {
      if (error.code === "23505") {
        alert("You have already reported this post.");
      } else {
        console.error("Error reporting:", error);
      }
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleDeletePost = async () => {
    setDeleting(true);
    try {
      // Delete media from storage first
      if (post?.media) {
        for (const media of post.media) {
          const path = media.url.split("/media/")[1];
          if (path) {
            await supabase.storage.from("media").remove([path]);
          }
        }
      }

      // Delete the post (cascade will delete media records, comments, etc.)
      await supabase.from("posts").delete().eq("id", postId);

      router.push("/");
    } catch (error) {
      console.error("Error deleting post:", error);
    } finally {
      setDeleting(false);
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    );
  }

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
          <div className="relative">
            <button
              onClick={() => setShowOptions(!showOptions)}
              className="p-2 -mr-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              <MoreVertical className="w-5 h-5 text-dark-200" />
            </button>

            {showOptions && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowOptions(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-48 glass-card p-2 z-50">
                  <button
                    onClick={() => {
                      handleShare();
                      setShowOptions(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 text-left"
                  >
                    <Share2 className="w-4 h-4 text-dark-400" />
                    <span className="text-dark-200">Share</span>
                  </button>
                  
                  {!isOwner && (
                    <button
                      onClick={() => {
                        setShowReportModal(true);
                        setShowOptions(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 text-left"
                    >
                      <Flag className="w-4 h-4 text-orange-400" />
                      <span className="text-dark-200">Report</span>
                    </button>
                  )}

                  {isOwner && (
                    <button
                      onClick={() => {
                        setShowDeleteModal(true);
                        setShowOptions(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 text-left"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                      <span className="text-red-400">Delete Post</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
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
                    ? "bg-primary-600 text-white shadow-lg shadow-primary-600/25"
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
              onClick={handleShare}
              className="p-3 rounded-xl glass-sm text-dark-400 hover:bg-white/10 transition-colors"
            >
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Comments Section */}
        <div id="comments" className="p-4 border-t border-white/5">
          <h3 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <MessageCircle className="w-5 h-5" />
            Updates & Comments ({comments.length})
          </h3>

          {/* Comment Input */}
          <div className="mb-6">
            <div className="flex gap-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add an update or comment..."
                className="flex-1 px-4 py-3 glass-input"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitComment();
                  }
                }}
              />
              <button
                onClick={handleSubmitComment}
                disabled={submittingComment || !newComment.trim()}
                className="p-3 bg-primary-600 rounded-xl text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {submittingComment ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={commentAnonymous}
                onChange={(e) => setCommentAnonymous(e.target.checked)}
                className="w-4 h-4 rounded border-dark-600 bg-dark-800 text-primary-600"
              />
              <span className="text-sm text-dark-400">Comment anonymously</span>
            </label>
          </div>

          {/* Comments List */}
          {comments.length === 0 ? (
            <div className="text-center py-8">
              <MessageCircle className="w-12 h-12 text-dark-600 mx-auto mb-3" />
              <p className="text-dark-400">No comments yet</p>
              <p className="text-sm text-dark-500">Be the first to add information</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center flex-shrink-0">
                    {comment.is_anonymous ? (
                      <User className="w-4 h-4 text-dark-400" />
                    ) : comment.user?.avatar_url ? (
                      <img
                        src={comment.user.avatar_url}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <User className="w-4 h-4 text-dark-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-dark-200">
                        {comment.is_anonymous ? "Anonymous" : comment.user?.full_name || "User"}
                      </span>
                      <span className="text-xs text-dark-500">
                        {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                      </span>
                      {comment.user_id === user?.id && (
                        <button
                          onClick={() => handleDeleteComment(comment.id)}
                          className="ml-auto p-1 hover:bg-white/5 rounded"
                        >
                          <Trash2 className="w-3 h-3 text-dark-500 hover:text-red-400" />
                        </button>
                      )}
                    </div>
                    <p className="text-dark-300 text-sm mt-1">{comment.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Report Modal */}
      <Modal isOpen={showReportModal} onClose={() => setShowReportModal(false)} title="Report Post">
        <div className="space-y-4">
          <p className="text-dark-400 text-sm">
            Why are you reporting this post?
          </p>

          <div className="space-y-2">
            {REPORT_REASONS.map((reason) => (
              <label
                key={reason.id}
                className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                  reportReason === reason.id
                    ? "bg-primary-600/20 border border-primary-500/50"
                    : "glass-sm hover:bg-white/5"
                }`}
              >
                <input
                  type="radio"
                  name="reason"
                  value={reason.id}
                  checked={reportReason === reason.id}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="mt-1"
                />
                <div>
                  <p className="text-dark-100 font-medium">{reason.label}</p>
                  <p className="text-sm text-dark-400">{reason.description}</p>
                </div>
              </label>
            ))}
          </div>

          {reportReason === "other" && (
            <textarea
              value={reportDescription}
              onChange={(e) => setReportDescription(e.target.value)}
              placeholder="Please describe the issue..."
              rows={3}
              className="w-full px-4 py-3 glass-input resize-none"
            />
          )}

          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setShowReportModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleReport}
              isLoading={submittingReport}
              disabled={!reportReason}
            >
              Submit Report
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete Post">
        <div className="space-y-4">
          <p className="text-dark-300">
            Are you sure you want to delete this post? This action cannot be undone.
          </p>

          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setShowDeleteModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleDeletePost}
              isLoading={deleting}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}