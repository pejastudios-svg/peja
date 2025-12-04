// src/app/post/[id]/page.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Post, CATEGORIES, REPORT_REASONS } from "@/lib/types";
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

interface CommentMedia {
  id: string;
  url: string;
  media_type: string;
}

interface CommentWithReplies {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  is_anonymous: boolean;
  created_at: string;
  parent_id?: string | null;
  user?: { full_name: string; avatar_url?: string };
  replies?: CommentWithReplies[];
  media?: CommentMedia[];
}

export default function PostDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const postId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);

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
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [commentMedia, setCommentMedia] = useState<File[]>([]);
  const [commentMediaPreviews, setCommentMediaPreviews] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());

  // Modals
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const isOwner = user?.id === post?.user_id;
  const isExpired = post ? differenceInHours(new Date(), new Date(post.created_at)) >= 24 : false;

  // Fetch post data
  const fetchPost = useCallback(async () => {
    if (!postId) return;
    
    try {
      const { data, error: fetchError } = await supabase
        .from("posts")
        .select(`
          *,
          post_media (*),
          post_tags (tag)
        `)
        .eq("id", postId)
        .single();

      if (fetchError) {
        console.error("Fetch post error:", fetchError);
        setError("Post not found");
        return;
      }

      setPost({
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
        report_count: data.report_count || 0,
        created_at: data.created_at,
        media: data.post_media || [],
        tags: data.post_tags?.map((t: any) => t.tag) || [],
      });

      // Increment views (don't await)
      supabase
        .from("posts")
        .update({ views: (data.views || 0) + 1 })
        .eq("id", postId)
        .then(() => {});

    } catch (err) {
      console.error("Error:", err);
      setError("Failed to load post");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  // Fetch comments
  const fetchComments = useCallback(async () => {
    if (!postId) return;

    try {
      // Get comments with user info
      const { data: commentsData, error: commentsError } = await supabase
        .from("post_comments")
        .select(`
          id,
          post_id,
          user_id,
          content,
          is_anonymous,
          created_at,
          parent_id,
          users:user_id (full_name, avatar_url)
        `)
        .eq("post_id", postId)
        .order("created_at", { ascending: true });

      if (commentsError) {
        console.error("Comments fetch error:", commentsError);
        return;
      }

      if (!commentsData || commentsData.length === 0) {
        setComments([]);
        return;
      }

      // Get media for all comments in one query
      const commentIds = commentsData.map(c => c.id);
      const { data: mediaData } = await supabase
        .from("comment_media")
        .select("*")
        .in("comment_id", commentIds);

      // Group media by comment_id
      const mediaMap: Record<string, CommentMedia[]> = {};
      (mediaData || []).forEach(m => {
        if (!mediaMap[m.comment_id]) mediaMap[m.comment_id] = [];
        mediaMap[m.comment_id].push(m);
      });

      // Build comments with media
      const commentsWithMedia: CommentWithReplies[] = commentsData.map(c => ({
        id: c.id,
        post_id: c.post_id,
        user_id: c.user_id,
        content: c.content || "",
        is_anonymous: c.is_anonymous,
        created_at: c.created_at,
        parent_id: c.parent_id,
        user: c.users as any,
        media: mediaMap[c.id] || [],
        replies: [],
      }));

      // Build tree structure
      const parentComments: CommentWithReplies[] = [];
      const childMap = new Map<string, CommentWithReplies[]>();

      commentsWithMedia.forEach((comment) => {
        if (comment.parent_id) {
          const existing = childMap.get(comment.parent_id) || [];
          existing.push(comment);
          childMap.set(comment.parent_id, existing);
        } else {
          parentComments.push(comment);
        }
      });

      parentComments.forEach((parent) => {
        parent.replies = childMap.get(parent.id) || [];
      });

      setComments(parentComments);
    } catch (err) {
      console.error("Error fetching comments:", err);
    }
  }, [postId]);

  // Check if user confirmed
  const checkIfConfirmed = useCallback(async () => {
    if (!postId || !user) return;

    const { data } = await supabase
      .from("post_confirmations")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .maybeSingle();

    setIsConfirmed(!!data);
  }, [postId, user]);

  useEffect(() => {
    if (postId) {
      fetchPost();
      fetchComments();
    }
  }, [postId, fetchPost, fetchComments]);

  useEffect(() => {
    if (user && postId) {
      checkIfConfirmed();
    }
  }, [user, postId, checkIfConfirmed]);

  // Handle confirm
  const handleConfirm = async () => {
    if (!user) {
      router.push("/login");
      return;
    }

    setConfirmLoading(true);
    try {
      if (isConfirmed) {
        await supabase
          .from("post_confirmations")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", user.id);

        setIsConfirmed(false);
        setPost(prev => prev ? { ...prev, confirmations: Math.max(0, prev.confirmations - 1) } : null);
      } else {
        await supabase
          .from("post_confirmations")
          .insert({ post_id: postId, user_id: user.id });

        setIsConfirmed(true);
        setPost(prev => prev ? { ...prev, confirmations: prev.confirmations + 1 } : null);
      }
    } catch (err) {
      console.error("Confirm error:", err);
    } finally {
      setConfirmLoading(false);
    }
  };

  // Handle media select for comments
  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length + commentMedia.length > 4) {
      alert("Maximum 4 files per comment");
      return;
    }

    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) {
        alert(`${file.name} is too large. Max 50MB.`);
        return;
      }
    }

    const previews = files.map(f => URL.createObjectURL(f));
    setCommentMedia(prev => [...prev, ...files]);
    setCommentMediaPreviews(prev => [...prev, ...previews]);
    e.target.value = "";
  };

  const removeCommentMedia = (index: number) => {
    URL.revokeObjectURL(commentMediaPreviews[index]);
    setCommentMedia(prev => prev.filter((_, i) => i !== index));
    setCommentMediaPreviews(prev => prev.filter((_, i) => i !== index));
  };

  // Submit comment
  const handleSubmitComment = async () => {
    if (!newComment.trim() && commentMedia.length === 0) {
      alert("Add a comment or media");
      return;
    }

    if (!user) {
      router.push("/login");
      return;
    }

    setSubmittingComment(true);
    setUploadProgress(0);

    try {
      // 1. Create comment
      const { data: commentData, error: commentError } = await supabase
        .from("post_comments")
        .insert({
          post_id: postId,
          user_id: user.id,
          content: newComment.trim(),
          is_anonymous: commentAnonymous,
          parent_id: replyingTo?.id || null,
        })
        .select("id")
        .single();

      if (commentError) {
        console.error("Comment error:", commentError);
        throw new Error(commentError.message);
      }

      // 2. Upload media
      if (commentMedia.length > 0) {
        for (let i = 0; i < commentMedia.length; i++) {
          const file = commentMedia[i];
          const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const fileName = `comments/${commentData.id}/${Date.now()}-${i}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from("media")
            .upload(fileName, file);

          if (uploadError) {
            console.error("Upload error:", uploadError);
            continue;
          }

          const { data: urlData } = supabase.storage
            .from("media")
            .getPublicUrl(fileName);

          await supabase.from("comment_media").insert({
            comment_id: commentData.id,
            url: urlData.publicUrl,
            media_type: file.type.startsWith("video/") ? "video" : "photo",
          });

          setUploadProgress(Math.round(((i + 1) / commentMedia.length) * 100));
        }
      }

      // 3. Reset and refresh
      setNewComment("");
      setCommentAnonymous(false);
      setReplyingTo(null);
      setCommentMedia([]);
      setCommentMediaPreviews([]);
      
      await fetchComments();

    } catch (err: any) {
      console.error("Submit error:", err);
      alert(err.message || "Failed to add comment");
    } finally {
      setSubmittingComment(false);
      setUploadProgress(0);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm("Delete this comment?")) return;

    try {
      await supabase.from("comment_media").delete().eq("comment_id", commentId);
      await supabase.from("post_comments").delete().eq("parent_id", commentId);
      await supabase.from("post_comments").delete().eq("id", commentId);
      await fetchComments();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/post/${postId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Peja Alert", url });
      } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      alert("Link copied!");
    }
  };

  const handleReport = async () => {
    if (!reportReason || !user) return;

    setSubmittingReport(true);
    try {
      await supabase.from("post_reports").insert({
        post_id: postId,
        user_id: user.id,
        reason: reportReason,
        description: reportDescription,
      });

      const newCount = (post?.report_count || 0) + 1;
      
      if (newCount >= 3) {
        await supabase.from("posts").update({ status: "archived" }).eq("id", postId);
        alert("Post removed due to multiple reports.");
        router.push("/");
        return;
      }

      await supabase.from("posts").update({ report_count: newCount }).eq("id", postId);

      setShowReportModal(false);
      setReportReason("");
      setReportDescription("");
      alert("Report submitted!");
    } catch (err: any) {
      if (err.code === "23505") {
        alert("Already reported.");
      } else {
        alert("Failed to report.");
      }
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleDeletePost = async () => {
    if (!post) return;

    setDeleting(true);
    try {
      await supabase.from("post_media").delete().eq("post_id", postId);
      await supabase.from("post_tags").delete().eq("post_id", postId);
      await supabase.from("post_confirmations").delete().eq("post_id", postId);
      await supabase.from("post_comments").delete().eq("post_id", postId);
      await supabase.from("post_reports").delete().eq("post_id", postId);
      await supabase.from("posts").delete().eq("id", postId);
      router.replace("/");
    } catch (err) {
      console.error("Delete error:", err);
      alert("Failed to delete.");
    } finally {
      setDeleting(false);
    }
  };

  const handleReply = (comment: CommentWithReplies) => {
    setReplyingTo({
      id: comment.id,
      name: comment.is_anonymous ? "Anonymous" : comment.user?.full_name || "User"
    });
    commentInputRef.current?.focus();
  };

  const toggleReplies = (commentId: string) => {
    setExpandedReplies(prev => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  // Render comment
  const renderComment = (comment: CommentWithReplies, isReply = false) => (
    <div key={comment.id} className={isReply ? "ml-10 mt-3" : ""}>
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {comment.is_anonymous ? (
            <User className="w-4 h-4 text-dark-400" />
          ) : comment.user?.avatar_url ? (
            <img src={comment.user.avatar_url} alt="" className="w-8 h-8 object-cover" />
          ) : (
            <User className="w-4 h-4 text-dark-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-dark-200">
              {comment.is_anonymous ? "Anonymous" : comment.user?.full_name || "User"}
            </span>
            <span className="text-xs text-dark-500">
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </span>
            {comment.user_id === user?.id && (
              <button onClick={() => handleDeleteComment(comment.id)} className="ml-auto p-1 hover:bg-white/5 rounded">
                <Trash2 className="w-3 h-3 text-dark-500 hover:text-red-400" />
              </button>
            )}
          </div>

          {comment.content && (
            <p className="text-dark-300 text-sm mt-1">{comment.content}</p>
          )}

          {comment.media && comment.media.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {comment.media.map((m) => (
                <div key={m.id} className="relative w-24 h-24 rounded-lg overflow-hidden bg-dark-800">
                  {m.media_type === "video" ? (
                    <video src={m.url} className="w-full h-full object-cover" controls playsInline preload="metadata" />
                  ) : (
                    <img src={m.url} alt="" className="w-full h-full object-cover cursor-pointer" onClick={() => window.open(m.url, "_blank")} />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 mt-2">
            {!isReply && (
              <button onClick={() => handleReply(comment)} className="flex items-center gap-1 text-xs text-dark-400 hover:text-primary-400">
                <Reply className="w-3 h-3" /> Reply
              </button>
            )}
            {!isReply && comment.replies && comment.replies.length > 0 && (
              <button onClick={() => toggleReplies(comment.id)} className="flex items-center gap-1 text-xs text-primary-400">
                {expandedReplies.has(comment.id) ? (
                  <><ChevronUp className="w-3 h-3" /> Hide {comment.replies.length} replies</>
                ) : (
                  <><ChevronDown className="w-3 h-3" /> View {comment.replies.length} replies</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {!isReply && comment.replies && expandedReplies.has(comment.id) && (
        <div className="mt-2 border-l-2 border-dark-700 pl-2">
          {comment.replies.map((reply) => renderComment(reply, true))}
        </div>
      )}
    </div>
  );

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
        <Button variant="primary" onClick={() => router.push("/")}>Go Home</Button>
      </div>
    );
  }

  const category = CATEGORIES.find((c) => c.id === post.category);
  const badgeVariant = category?.color === "danger" ? "danger" : category?.color === "warning" ? "warning" : "info";
  const currentMedia = post.media?.[currentMediaIndex];
  const commentText = post.comment || "";
  const isLongDescription = commentText.length > 200;
  const displayedComment = isLongDescription && !showFullDescription ? commentText.slice(0, 200) + "..." : commentText;

  return (
    <div className="min-h-screen pb-32">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass-header">
        <div className="flex items-center justify-between px-4 h-14 max-w-2xl mx-auto">
          <button onClick={() => router.back()} className="p-2 -ml-2 hover:bg-white/10 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-dark-200" />
          </button>
          <h1 className="text-lg font-semibold text-dark-100">Incident Details</h1>
          <div className="relative">
            <button onClick={() => setShowOptions(!showOptions)} className="p-2 -mr-2 hover:bg-white/10 rounded-lg">
              <MoreVertical className="w-5 h-5 text-dark-200" />
            </button>
            {showOptions && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowOptions(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 glass-strong rounded-xl p-2 z-50">
                  <button onClick={() => { handleShare(); setShowOptions(false); }} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10">
                    <Share2 className="w-4 h-4 text-dark-400" />
                    <span className="text-dark-200">Share</span>
                  </button>
                  {!isOwner && (
                    <button onClick={() => { setShowReportModal(true); setShowOptions(false); }} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10">
                      <Flag className="w-4 h-4 text-orange-400" />
                      <span className="text-dark-200">Report</span>
                    </button>
                  )}
                  {isOwner && (
                    <button onClick={() => { setShowDeleteModal(true); setShowOptions(false); }} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10">
                      <Trash2 className="w-4 h-4 text-red-400" />
                      <span className="text-red-400">Delete</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="pt-14 max-w-2xl mx-auto">
        {/* Media */}
        {post.media && post.media.length > 0 && (
          <div className="relative bg-dark-900">
            {post.is_sensitive && !showSensitive ? (
              <div className="aspect-video flex flex-col items-center justify-center bg-dark-800">
                <AlertTriangle className="w-12 h-12 text-orange-400 mb-3" />
                <p className="text-dark-200 font-medium mb-1">Sensitive Content</p>
                <Button variant="secondary" size="sm" onClick={() => setShowSensitive(true)}>View</Button>
              </div>
            ) : (
              <div className="relative aspect-video bg-black">
                {currentMedia?.media_type === "video" ? (
                  <video
                    key={currentMedia.url}
                    className="w-full h-full object-contain"
                    controls
                    playsInline
                    preload="metadata"
                  >
                    <source src={currentMedia.url} type="video/mp4" />
                  </video>
                ) : (
                  <img src={currentMedia?.url} alt="" className="w-full h-full object-contain" />
                )}

                {post.media.length > 1 && (
                  <>
                    <button
                      onClick={() => setCurrentMediaIndex(i => i === 0 ? post.media!.length - 1 : i - 1)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/60 rounded-full"
                    >
                      <ChevronLeft className="w-6 h-6 text-white" />
                    </button>
                    <button
                      onClick={() => setCurrentMediaIndex(i => i === post.media!.length - 1 ? 0 : i + 1)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/60 rounded-full"
                    >
                      <ChevronRight className="w-6 h-6 text-white" />
                    </button>
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                      {post.media.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setCurrentMediaIndex(i)}
                          className={`w-2 h-2 rounded-full ${i === currentMediaIndex ? "bg-white" : "bg-white/40"}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <Badge variant={badgeVariant}>{category?.name || post.category}</Badge>
            {!isExpired ? (
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/20">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-xs font-medium text-red-400">LIVE</span>
              </span>
            ) : (
              <span className="text-xs text-dark-400">
                {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
              </span>
            )}
          </div>

          {displayedComment && (
            <div>
              <p className="text-dark-100 text-lg">{displayedComment}</p>
              {isLongDescription && (
                <button onClick={() => setShowFullDescription(!showFullDescription)} className="text-sm text-primary-400 mt-1">
                  {showFullDescription ? "Show less" : "View more"}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-sm text-dark-400">
            {post.address && (
              <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{post.address}</span>
            )}
            <span className="flex items-center gap-1"><Clock className="w-4 h-4" />{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</span>
            <span className="flex items-center gap-1"><Eye className="w-4 h-4" />{post.views} views</span>
          </div>

          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {post.tags.map((tag, i) => (
                <span key={i} className="text-primary-400 text-sm">#{tag}</span>
              ))}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleConfirm}
              disabled={confirmLoading}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all ${isConfirmed ? "bg-primary-600 text-white" : "glass-sm text-dark-200 hover:bg-white/10"}`}
            >
              {confirmLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className={`w-5 h-5 ${isConfirmed ? "fill-current" : ""}`} />}
              <span>{isConfirmed ? "Confirmed!" : "Confirm"}</span>
              <span className="text-dark-400">({post.confirmations})</span>
            </button>
            <button onClick={handleShare} className="p-3 rounded-xl glass-sm text-dark-400 hover:bg-white/10">
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Comments */}
        <div className="p-4 border-t border-white/5">
          <h3 className="text-lg font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <MessageCircle className="w-5 h-5" />
            Comments ({comments.length})
          </h3>

          {comments.length === 0 ? (
            <div className="text-center py-8">
              <MessageCircle className="w-12 h-12 text-dark-600 mx-auto mb-3" />
              <p className="text-dark-400">No comments yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => renderComment(comment))}
            </div>
          )}
        </div>
      </main>

      {/* Comment Input */}
      <div className="fixed-bottom-input">
        <div className="max-w-2xl mx-auto">
          {replyingTo && (
            <div className="flex items-center justify-between mb-2 px-2">
              <span className="text-xs text-primary-400">Replying to {replyingTo.name}</span>
              <button onClick={() => setReplyingTo(null)} className="text-xs text-dark-400">Cancel</button>
            </div>
          )}

          {commentMediaPreviews.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-2">
              {commentMediaPreviews.map((preview, i) => (
                <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden flex-shrink-0">
                  <img src={preview} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => removeCommentMedia(i)} className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center">
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {submittingComment && uploadProgress > 0 && (
            <div className="mb-2">
              <div className="w-full bg-dark-700 rounded-full h-1">
                <div className="bg-primary-500 h-1 rounded-full" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={commentAnonymous} onChange={e => setCommentAnonymous(e.target.checked)} className="w-4 h-4 rounded border-dark-600 bg-dark-800 text-primary-600" />
              <span className="text-xs text-dark-400">Anon</span>
            </label>

            <button onClick={() => fileInputRef.current?.click()} className="p-2 hover:bg-white/10 rounded-lg text-dark-400">
              <ImageIcon className="w-5 h-5" />
            </button>
            <input type="file" ref={fileInputRef} onChange={handleMediaSelect} accept="image/*,video/*" multiple className="hidden" />

            <input
              ref={commentInputRef}
              type="text"
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder={replyingTo ? "Write a reply..." : "Add a comment..."}
              className="flex-1 px-4 py-2.5 glass-input text-base"
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmitComment(); } }}
              disabled={submittingComment}
            />

            <button
              onClick={handleSubmitComment}
              disabled={submittingComment || (!newComment.trim() && commentMedia.length === 0)}
              className="p-2.5 bg-primary-600 rounded-xl text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {submittingComment ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Report Modal */}
      <Modal isOpen={showReportModal} onClose={() => setShowReportModal(false)} title="Report Post">
        <div className="space-y-4">
          {REPORT_REASONS.map((reason) => (
            <label key={reason.id} className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer ${reportReason === reason.id ? "bg-primary-600/20 border border-primary-500/50" : "glass-sm"}`}>
              <input type="radio" name="reason" value={reason.id} checked={reportReason === reason.id} onChange={e => setReportReason(e.target.value)} className="mt-1" />
              <div>
                <p className="text-dark-100 font-medium">{reason.label}</p>
                <p className="text-sm text-dark-400">{reason.description}</p>
              </div>
            </label>
          ))}
          {reportReason === "other" && (
            <textarea value={reportDescription} onChange={e => setReportDescription(e.target.value)} placeholder="Describe..." rows={3} className="w-full px-4 py-3 glass-input resize-none" />
          )}
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowReportModal(false)}>Cancel</Button>
            <Button variant="primary" className="flex-1" onClick={handleReport} isLoading={submittingReport} disabled={!reportReason}>Submit</Button>
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete Post">
        <p className="text-dark-300 mb-4">Delete this post? This cannot be undone.</p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
          <Button variant="danger" className="flex-1" onClick={handleDeletePost} isLoading={deleting}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}