"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, Comment, CATEGORIES, REPORT_REASONS } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDistanceToNow, differenceInHours } from "date-fns";
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
  Image as ImageIcon,
  X,
  Reply,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface CommentWithReplies extends Comment {
  replies?: CommentWithReplies[];
  media?: { id: string; url: string; media_type: string }[];
}

export default function PostDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const postId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<CommentWithReplies[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showSensitive, setShowSensitive] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);

  // Comment state
  const [newComment, setNewComment] = useState("");
  const [commentAnonymous, setCommentAnonymous] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [commentMedia, setCommentMedia] = useState<File[]>([]);
  const [commentMediaPreviews, setCommentMediaPreviews] = useState<string[]>([]);

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
  
  // Check if post is older than 24 hours
  const isExpired = post ? differenceInHours(new Date(), new Date(post.created_at)) >= 24 : false;

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
          users:user_id (full_name, avatar_url),
          comment_media (*)
        `)
        .eq("post_id", postId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Organize comments into parent/child structure
      const allComments: CommentWithReplies[] = data?.map((c: any) => ({
        id: c.id,
        post_id: c.post_id,
        user_id: c.user_id,
        content: c.content,
        is_anonymous: c.is_anonymous,
        created_at: c.created_at,
        parent_id: c.parent_id,
        user: c.users,
        media: c.comment_media || [],
        replies: [],
      })) || [];

      // Build tree structure
      const parentComments: CommentWithReplies[] = [];
      const childMap = new Map<string, CommentWithReplies[]>();

      allComments.forEach((comment) => {
        if (comment.parent_id) {
          const existing = childMap.get(comment.parent_id) || [];
          existing.push(comment);
          childMap.set(comment.parent_id, existing);
        } else {
          parentComments.push(comment);
        }
      });

      // Attach replies to parents
      parentComments.forEach((parent) => {
        parent.replies = childMap.get(parent.id) || [];
      });

      setComments(parentComments);
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

  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length + commentMedia.length > 4) {
      alert("Maximum 4 images/videos per comment");
      return;
    }
    
    const previews = files.map((f) => URL.createObjectURL(f));
    setCommentMedia((prev) => [...prev, ...files]);
    setCommentMediaPreviews((prev) => [...prev, ...previews]);
  };

  const removeCommentMedia = (index: number) => {
    URL.revokeObjectURL(commentMediaPreviews[index]);
    setCommentMedia((prev) => prev.filter((_, i) => i !== index));
    setCommentMediaPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim() && commentMedia.length === 0) return;

    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      router.push("/login");
      return;
    }

    setSubmittingComment(true);
    try {
      // Create comment
      const { data: commentData, error: commentError } = await supabase
        .from("post_comments")
        .insert({
          post_id: postId,
          user_id: authUser.id,
          content: newComment.trim(),
          is_anonymous: commentAnonymous,
          parent_id: replyingTo,
        })
        .select()
        .single();

      if (commentError) throw commentError;

      // Upload media if any
      if (commentMedia.length > 0) {
        for (const file of commentMedia) {
          const fileExt = file.name.split(".").pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = `comments/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from("media")
            .upload(filePath, file);

          if (!uploadError) {
            const { data: publicUrl } = supabase.storage
              .from("media")
              .getPublicUrl(filePath);

            await supabase.from("comment_media").insert({
              comment_id: commentData.id,
              url: publicUrl.publicUrl,
              media_type: file.type.startsWith("video/") ? "video" : "photo",
            });
          }
        }
      }

      // Reset form
      setNewComment("");
      setCommentAnonymous(false);
      setReplyingTo(null);
      setCommentMedia([]);
      setCommentMediaPreviews([]);

      // Refresh comments
      fetchComments();
    } catch (error) {
      console.error("Error submitting comment:", error);
      alert("Failed to add comment. Please try again.");
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      const { error } = await supabase.from("post_comments").delete().eq("id", commentId);
      if (error) throw error;
      fetchComments();
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
      const { error } = await supabase.from("post_reports").insert({
        post_id: postId,
        user_id: authUser.id,
        reason: reportReason,
        description: reportDescription,
      });

      if (error) {
        if (error.code === "23505") {
          alert("You have already reported this post.");
        } else {
          throw error;
        }
      } else {
        setShowReportModal(false);
        setReportReason("");
        setReportDescription("");
        alert("Report submitted. Thank you for helping keep Peja safe!");
      }
    } catch (error: any) {
      console.error("Error reporting:", error);
      alert("Failed to submit report. Please try again.");
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleDeletePost = async () => {
    if (!post || !user) return;
    
    setDeleting(true);
    try {
      // First delete all related records manually to avoid RLS issues
      
      // 1. Delete post media files from storage
      if (post.media && post.media.length > 0) {
        for (const media of post.media) {
          try {
            const urlParts = media.url.split("/storage/v1/object/public/media/");
            if (urlParts[1]) {
              await supabase.storage.from("media").remove([urlParts[1]]);
            }
          } catch (e) {
            console.error("Error deleting media file:", e);
          }
        }
      }

      // 2. Delete post_media records
      await supabase.from("post_media").delete().eq("post_id", postId);
      
      // 3. Delete post_tags records
      await supabase.from("post_tags").delete().eq("post_id", postId);
      
      // 4. Delete post_confirmations records
      await supabase.from("post_confirmations").delete().eq("post_id", postId);
      
      // 5. Delete comment_media for all comments on this post
      const { data: postComments } = await supabase
        .from("post_comments")
        .select("id")
        .eq("post_id", postId);
      
      if (postComments) {
        for (const comment of postComments) {
          await supabase.from("comment_media").delete().eq("comment_id", comment.id);
        }
      }
      
      // 6. Delete post_comments records
      await supabase.from("post_comments").delete().eq("post_id", postId);
      
      // 7. Delete post_reports records
      await supabase.from("post_reports").delete().eq("post_id", postId);

      // 8. Finally delete the post
      const { error: deleteError } = await supabase
        .from("posts")
        .delete()
        .eq("id", postId)
        .eq("user_id", user.id); // Ensure user owns the post
      
      if (deleteError) {
        console.error("Delete error:", deleteError);
        throw deleteError;
      }

      setShowDeleteModal(false);
      
      // Use replace to prevent going back to deleted post
      router.replace("/");
    } catch (error) {
      console.error("Error deleting post:", error);
      alert("Failed to delete post. Please try again.");
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

  // Render a single comment with replies
  const renderComment = (comment: CommentWithReplies, isReply = false) => (
    <div key={comment.id} className={`${isReply ? "ml-10 mt-3" : ""}`}>
      <div className="flex gap-3">
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
          <div className="flex items-center gap-2 flex-wrap">
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
          
          {/* Comment Media */}
          {comment.media && comment.media.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {comment.media.map((media) => (
                <div key={media.id} className="w-20 h-20 rounded-lg overflow-hidden bg-dark-800">
                  {media.media_type === "video" ? (
                    <video src={media.url} className="w-full h-full object-cover" />
                  ) : (
                    <img src={media.url} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
              ))}
            </div>
          )}
          
          {/* Reply button */}
          {!isReply && (
            <button
              onClick={() => setReplyingTo(comment.id)}
              className="flex items-center gap-1 mt-2 text-xs text-dark-400 hover:text-primary-400"
            >
              <Reply className="w-3 h-3" />
              Reply
            </button>
          )}
        </div>
      </div>
      
      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-2">
          {comment.replies.map((reply) => renderComment(reply, true))}
        </div>
      )}
    </div>
  );

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
  
  // Check if description is long
  const isLongDescription = post.comment && post.comment.length > 200;
  const displayedComment = isLongDescription && !showFullDescription 
    ? post.comment.slice(0, 200) + "..." 
    : post.comment;

  return (
    <div className="min-h-screen pb-28">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass-header">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Incident Details</h1>
          <div className="relative">
            <button
              onClick={() => setShowOptions(!showOptions)}
              className="p-2 -mr-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <MoreVertical className="w-5 h-5 text-dark-200" />
            </button>

            {showOptions && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowOptions(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-48 glass-strong rounded-xl p-2 z-50">
                  <button
                    onClick={() => {
                      handleShare();
                      setShowOptions(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 text-left"
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
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 text-left"
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
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 text-left"
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
            {/* Show LIVE only if not expired (< 24 hours old) */}
            {!isExpired ? (
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/20">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-xs font-medium text-red-400">LIVE</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-dark-600">
                <span className="w-2 h-2 bg-dark-400 rounded-full" />
                <span className="text-xs font-medium text-dark-400">
                  {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                </span>
              </span>
            )}
          </div>

          {/* Comment/Description with View More */}
          {post.comment && (
            <div>
              <p className="text-dark-100 text-lg leading-relaxed">
                {displayedComment}
              </p>
              {isLongDescription && (
                <button
                  onClick={() => setShowFullDescription(!showFullDescription)}
                  className="flex items-center gap-1 mt-2 text-sm text-primary-400 hover:text-primary-300"
                >
                  {showFullDescription ? (
                    <>
                      <ChevronUp className="w-4 h-4" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      View more
                    </>
                  )}
                </button>
              )}
            </div>
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

          {/* Comments List */}
          {comments.length === 0 ? (
            <div className="text-center py-8">
              <MessageCircle className="w-12 h-12 text-dark-600 mx-auto mb-3" />
              <p className="text-dark-400">No comments yet</p>
              <p className="text-sm text-dark-500">Be the first to add information</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => renderComment(comment))}
            </div>
          )}
        </div>
      </main>

      {/* Fixed Comment Input at Bottom */}
      <div className="fixed-bottom-input">
        <div className="max-w-2xl mx-auto">
          {/* Replying to indicator */}
          {replyingTo && (
            <div className="flex items-center justify-between mb-2 px-2">
              <span className="text-xs text-primary-400">
                Replying to comment...
              </span>
              <button
                onClick={() => setReplyingTo(null)}
                className="text-xs text-dark-400 hover:text-dark-200"
              >
                Cancel
              </button>
            </div>
          )}
          
          {/* Media previews */}
          {commentMediaPreviews.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-2">
              {commentMediaPreviews.map((preview, index) => (
                <div key={index} className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                  <img src={preview} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeCommentMedia(index)}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={commentAnonymous}
                onChange={(e) => setCommentAnonymous(e.target.checked)}
                className="w-4 h-4 rounded border-dark-600 bg-dark-800 text-primary-600"
              />
              <span className="text-xs text-dark-400">Anon</span>
            </label>
            
            {/* Media upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 hover:bg-white/10 rounded-lg text-dark-400"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleMediaSelect}
              accept="image/*,video/*"
              multiple
              className="hidden"
            />
            
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={replyingTo ? "Write a reply..." : "Add an update or comment..."}
              className="flex-1 px-4 py-2.5 glass-input text-base"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitComment();
                }
              }}
            />
            <button
              onClick={handleSubmitComment}
              disabled={submittingComment || (!newComment.trim() && commentMedia.length === 0)}
              className="p-2.5 bg-primary-600 rounded-xl text-white hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submittingComment ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

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
              className="w-full px-4 py-3 glass-input resize-none text-base"
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
              disabled={deleting}
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